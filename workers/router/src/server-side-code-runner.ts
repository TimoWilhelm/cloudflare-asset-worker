import { env } from 'cloudflare:workers';

import { computeContentHash } from './content-utilities';
import { getServerSideCodeKey } from './project-manager';
import { batchGetKv } from '../../shared/kv';

import type { ServerSideCodeManifest } from './types';

/**
 * Fetches the server-side code manifest for a project from KV.
 *
 * @param projectId - The unique identifier of the project
 * @returns The server-side code manifest or null if not found
 */
export async function getServerSideCodeManifest(projectId: string): Promise<ServerSideCodeManifest | undefined> {
	const manifestKey = getServerSideCodeKey(projectId, 'MANIFEST');
	const manifest = await env.KV_SERVER_SIDE_CODE.get<ServerSideCodeManifest>(manifestKey, { type: 'json', cacheTtl: 300 });
	return manifest || undefined;
}

/**
 * Executes server-side code for a project using dynamic worker loading.
 *
 * @param projectId - The unique identifier of the project
 * @param request - The HTTP request to pass to the server-side code
 * @param bindings - Environment bindings to inject (e.g., ASSETS binding)
 * @param prefetchedManifest - Optional pre-fetched manifest to avoid redundant KV read
 * @returns The response from the dynamically loaded worker
 * @throws Error if the server-side code manifest or modules are not found
 */
export async function runServerSideCode(
	projectId: string,
	request: Request,
	bindings: Record<string, unknown>,
	prefetchedManifest?: ServerSideCodeManifest | undefined,
): Promise<Response> {
	// Use pre-fetched manifest if available, otherwise load from KV
	const manifest = prefetchedManifest === undefined ? await getServerSideCodeManifest(projectId) : prefetchedManifest;

	if (!manifest) {
		return new Response('Server-side code not found', { status: 404 });
	}

	const { entrypoint, modules: moduleManifest, compatibilityDate, env: manifestEnvironment = {} } = manifest;

	// Use content hash of the manifest as the worker key for caching
	const codeHash = await computeContentHash(new TextEncoder().encode(JSON.stringify(manifest)));

	const worker = env.LOADER.get(codeHash, async () => {
		// Load all modules from KV by their content hashes and decode based on type
		// This only runs when there is no warm isolate for this codeHash
		const modules: Record<string, WorkerLoaderModule | string> = {};

		const binaryTypes = new Set(['data', 'wasm']);
		const allEntries = Object.entries(moduleManifest);
		const textEntries = allEntries.filter(([, { type }]) => !binaryTypes.has(type));
		const binaryEntries = allEntries.filter(([, { type }]) => binaryTypes.has(type));

		// Each closure returns its own entries to avoid concurrent writes to a shared object
		const textPromise = (async (): Promise<Record<string, WorkerLoaderModule | string>> => {
			if (textEntries.length === 0) return {};
			const result: Record<string, WorkerLoaderModule | string> = {};
			const textKeys = textEntries.map(([, { hash }]) => getServerSideCodeKey(projectId, hash));
			const textResults = await batchGetKv(env.KV_SERVER_SIDE_CODE, textKeys, { type: 'text', cacheTtl: 86_400 });

			for (const [modulePath, { hash: contentHash, type }] of textEntries) {
				const moduleKey = getServerSideCodeKey(projectId, contentHash);
				const textValue = textResults.get(moduleKey) ?? undefined;

				if (textValue === undefined) {
					throw new Error(`Module ${modulePath} with hash ${contentHash} not found in KV`);
				}

				switch (type) {
					case 'js': {
						result[modulePath] = { js: textValue };
						break;
					}
					case 'cjs': {
						result[modulePath] = { cjs: textValue };
						break;
					}
					case 'py': {
						result[modulePath] = { py: textValue };
						break;
					}
					case 'text': {
						result[modulePath] = { text: textValue };
						break;
					}
					case 'json': {
						result[modulePath] = { json: JSON.parse(textValue) };
						break;
					}
					default: {
						// Fallback to plain string for unknown types
						result[modulePath] = textValue;
					}
				}
			}
			return result;
		})();

		// Load binary modules individually (batch API does not support arrayBuffer)
		const binaryPromise = (async (): Promise<Record<string, WorkerLoaderModule | string>> => {
			if (binaryEntries.length === 0) return {};
			const entries = await Promise.all(
				binaryEntries.map(async ([modulePath, { hash: contentHash, type }]): Promise<[string, WorkerLoaderModule]> => {
					const moduleKey = getServerSideCodeKey(projectId, contentHash);
					const rawBuffer = await env.KV_SERVER_SIDE_CODE.get(moduleKey, { type: 'arrayBuffer', cacheTtl: 86_400 });

					if (!rawBuffer) {
						throw new Error(`Module ${modulePath} with hash ${contentHash} not found in KV`);
					}

					switch (type) {
						case 'data': {
							return [modulePath, { data: rawBuffer }];
						}
						case 'wasm': {
							return [modulePath, { wasm: rawBuffer }];
						}
						default: {
							throw new Error(`Unexpected binary module type: ${type}`);
						}
					}
				}),
			);
			return Object.fromEntries(entries);
		})();

		const [textModules, binaryModules] = await Promise.all([textPromise, binaryPromise]);
		Object.assign(modules, textModules, binaryModules);

		return {
			compatibilityDate: compatibilityDate || '2025-11-09',
			compatibilityFlags: ['nodejs_compat'],
			mainModule: entrypoint,
			modules,
			env: {
				...manifestEnvironment,
				...bindings,
			},
			globalOutbound: undefined, // disable internet access
		};
	});

	const defaultEntrypoint = worker.getEntrypoint(undefined, {});

	return await defaultEntrypoint.fetch(request);
}
