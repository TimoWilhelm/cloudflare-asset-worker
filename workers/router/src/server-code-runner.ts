import { env } from 'cloudflare:workers';
import type { ServerCodeManifest } from './types';
import { computeContentHash } from './content-utils';
import { getServerCodeKey } from './project-manager';
import { batchGetKv } from '../../shared/kv';

/**
 * Fetches the server code manifest for a project from KV.
 *
 * @param projectId - The unique identifier of the project
 * @returns The server code manifest or null if not found
 */
export async function getServerCodeManifest(projectId: string): Promise<ServerCodeManifest | null> {
	const manifestKey = getServerCodeKey(projectId, 'MANIFEST');
	return await env.KV_SERVER_CODE.get<ServerCodeManifest>(manifestKey, { type: 'json', cacheTtl: 300 });
}

/**
 * Executes server code for a project using dynamic worker loading.
 *
 * @param projectId - The unique identifier of the project
 * @param request - The HTTP request to pass to the server code
 * @param bindings - Environment bindings to inject (e.g., ASSETS binding)
 * @param prefetchedManifest - Optional pre-fetched manifest to avoid redundant KV read
 * @returns The response from the dynamically loaded worker
 * @throws Error if the server code manifest or modules are not found
 */
export async function runServerCode(projectId: string, request: Request, bindings: any, prefetchedManifest?: ServerCodeManifest | null): Promise<Response> {
	// Use pre-fetched manifest if available, otherwise load from KV
	const manifest = prefetchedManifest !== undefined ? prefetchedManifest : await getServerCodeManifest(projectId);

	if (!manifest) {
		return new Response('Server code not found', { status: 404 });
	}

	const { entrypoint, modules: moduleManifest, compatibilityDate, env: manifestEnv = {} } = manifest;

	// Use content hash of the manifest as the worker key for caching
	const codeHash = await computeContentHash(new TextEncoder().encode(JSON.stringify(manifest)));

	const worker = env.LOADER.get(codeHash, async () => {
		// Load all modules from KV by their content hashes and decode based on type
		// This only runs when there is no warm isolate for this codeHash
		const modules: Record<string, any> = {};

		const binaryTypes = new Set(['data', 'wasm']);
		const allEntries = Object.entries(moduleManifest);
		const textEntries = allEntries.filter(([, { type }]) => !binaryTypes.has(type));
		const binaryEntries = allEntries.filter(([, { type }]) => binaryTypes.has(type));

		// Load text and binary modules in parallel to minimize I/O wait
		// Each closure returns its own entries to avoid concurrent writes to a shared object
		const textPromise = (async (): Promise<Record<string, any>> => {
			if (textEntries.length === 0) return {};
			const result: Record<string, any> = {};
			const textKeys = textEntries.map(([, { hash }]) => getServerCodeKey(projectId, hash));
			const textResults = await batchGetKv(env.KV_SERVER_CODE, textKeys, { type: 'text', cacheTtl: 86400 });

			for (const [modulePath, { hash: contentHash, type }] of textEntries) {
				const moduleKey = getServerCodeKey(projectId, contentHash);
				const textValue = textResults.get(moduleKey) ?? null;

				if (textValue === null) {
					throw new Error(`Module ${modulePath} with hash ${contentHash} not found in KV`);
				}

				switch (type) {
					case 'js':
						result[modulePath] = { js: textValue };
						break;
					case 'cjs':
						result[modulePath] = { cjs: textValue };
						break;
					case 'py':
						result[modulePath] = { py: textValue };
						break;
					case 'text':
						result[modulePath] = { text: textValue };
						break;
					case 'json':
						result[modulePath] = { json: JSON.parse(textValue) };
						break;
					default:
						// Fallback to plain string for unknown types
						result[modulePath] = textValue;
				}
			}
			return result;
		})();

		// Load binary modules individually (batch API does not support arrayBuffer)
		const binaryPromise = (async (): Promise<Record<string, any>> => {
			if (binaryEntries.length === 0) return {};
			const result: Record<string, any> = {};
			await Promise.all(
				binaryEntries.map(async ([modulePath, { hash: contentHash, type }]) => {
					const moduleKey = getServerCodeKey(projectId, contentHash);
					const rawBuffer = await env.KV_SERVER_CODE.get(moduleKey, { type: 'arrayBuffer', cacheTtl: 86400 });

					if (!rawBuffer) {
						throw new Error(`Module ${modulePath} with hash ${contentHash} not found in KV`);
					}

					switch (type) {
						case 'data':
							result[modulePath] = { data: rawBuffer };
							break;
						case 'wasm':
							result[modulePath] = { wasm: rawBuffer };
							break;
					}
				}),
			);
			return result;
		})();

		const [textModules, binaryModules] = await Promise.all([textPromise, binaryPromise]);
		Object.assign(modules, textModules, binaryModules);

		return {
			compatibilityDate: compatibilityDate || '2025-11-09',
			compatibilityFlags: ['nodejs_compat'],
			mainModule: entrypoint,
			modules,
			env: {
				...manifestEnv,
				...bindings,
			},
			globalOutbound: null, // disable internet access
		};
	});

	const defaultEntrypoint = worker.getEntrypoint(undefined, {});

	return await defaultEntrypoint.fetch(request);
}
