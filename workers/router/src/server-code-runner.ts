import { env } from 'cloudflare:workers';
import type { ServerCodeManifest } from './types';
import { computeContentHash } from './content-utils';
import { getServerCodeKey } from './project-manager';
import { batchGetKv } from '../../shared/kv';

/**
 * Executes server code for a project using dynamic worker loading.
 *
 * @param projectId - The unique identifier of the project
 * @param request - The HTTP request to pass to the server code
 * @param bindings - Environment bindings to inject (e.g., ASSETS binding)
 * @returns The response from the dynamically loaded worker
 * @throws Error if the server code manifest or modules are not found
 */
export async function runServerCode(projectId: string, request: Request, bindings: any): Promise<Response> {
	// Load the manifest
	const manifestKey = getServerCodeKey(projectId, 'MANIFEST');
	const manifest = await env.KV_SERVER_CODE.get<ServerCodeManifest>(manifestKey, { type: 'json', cacheTtl: 300 });

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

		// Batch-read text-based modules in a single subrequest
		if (textEntries.length > 0) {
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
						modules[modulePath] = { js: textValue };
						break;
					case 'cjs':
						modules[modulePath] = { cjs: textValue };
						break;
					case 'py':
						modules[modulePath] = { py: textValue };
						break;
					case 'text':
						modules[modulePath] = { text: textValue };
						break;
					case 'json':
						modules[modulePath] = { json: JSON.parse(textValue) };
						break;
					default:
						// Fallback to plain string for unknown types
						modules[modulePath] = textValue;
				}
			}
		}

		// Load binary modules individually (batch API does not support arrayBuffer)
		await Promise.all(
			binaryEntries.map(async ([modulePath, { hash: contentHash, type }]) => {
				const moduleKey = getServerCodeKey(projectId, contentHash);
				const rawBuffer = await env.KV_SERVER_CODE.get(moduleKey, { type: 'arrayBuffer', cacheTtl: 86400 });

				if (!rawBuffer) {
					throw new Error(`Module ${modulePath} with hash ${contentHash} not found in KV`);
				}

				switch (type) {
					case 'data':
						modules[modulePath] = { data: rawBuffer };
						break;
					case 'wasm':
						modules[modulePath] = { wasm: rawBuffer };
						break;
				}
			}),
		);

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
