import { env } from 'cloudflare:workers';
import type { ServerCodeManifest } from './types';
import * as base64 from '@stablelib/base64';
import { computeContentHash } from './content-utils';
import { getServerCodeKey } from './project-manager';

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
	// Load the manifest (cached)
	const manifestKey = getServerCodeKey(projectId, 'MANIFEST');
	const manifest = await env.KV_SERVER_CODE.get<ServerCodeManifest>(manifestKey, { type: 'json' });

	if (!manifest) {
		return new Response('Server code not found', { status: 404 });
	}

	const { entrypoint, modules: moduleManifest, compatibilityDate, env: manifestEnv = {} } = manifest;

	// Load all modules from KV by their content hashes and decode based on type
	const modules: Record<string, any> = {};
	await Promise.all(
		Object.entries(moduleManifest).map(async ([modulePath, { hash: contentHash, type }]) => {
			const moduleKey = getServerCodeKey(projectId, contentHash);
			// Load module from KV (cached)
			const base64Content = await env.KV_SERVER_CODE.get(moduleKey, { type: 'text' });

			if (!base64Content) {
				throw new Error(`Module ${modulePath} with hash ${contentHash} not found in KV`);
			}

			// Decode base64 content and format according to module type
			const decodedBytes = base64.decode(base64Content);

			switch (type) {
				case 'js':
					modules[modulePath] = { js: new TextDecoder().decode(decodedBytes) };
					break;
				case 'cjs':
					modules[modulePath] = { cjs: new TextDecoder().decode(decodedBytes) };
					break;
				case 'py':
					modules[modulePath] = { py: new TextDecoder().decode(decodedBytes) };
					break;
				case 'text':
					modules[modulePath] = { text: new TextDecoder().decode(decodedBytes) };
					break;
				case 'data':
					modules[modulePath] = { data: decodedBytes.buffer };
					break;
				case 'json':
					const jsonString = new TextDecoder().decode(decodedBytes);
					modules[modulePath] = { json: JSON.parse(jsonString) };
					break;
				case 'wasm':
					modules[modulePath] = { wasm: decodedBytes.buffer };
					break;
				default:
					// Fallback to plain string for unknown types
					modules[modulePath] = new TextDecoder().decode(decodedBytes);
			}
		}),
	);

	// Use content hash of the manifest as the worker key for caching
	const codeHash = await computeContentHash(new TextEncoder().encode(JSON.stringify(manifest)));

	const worker = env.LOADER.get(codeHash, () => {
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
