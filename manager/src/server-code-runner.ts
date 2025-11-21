import type { ServerCodeManifest } from './types';
import type { AssetConfig } from '../../api/src/configuration';
import * as base64 from '@stablelib/base64';
import { computeContentHash } from './content-utils';
import { getServerCodeKey } from './project-manager';
import { WorkerEntrypoint } from 'cloudflare:workers';

/**
 * Run server code for a project using dynamic worker loading
 */
export async function runServerCode(
	request: Request,
	projectId: string,
	serverCodeKv: KVNamespace,
	loader: WorkerLoader,
	bindings: any,
	assetConfig?: AssetConfig
): Promise<Response> {
	// Load the manifest
	const manifestKey = getServerCodeKey(projectId, 'MANIFEST');
	const manifest = await serverCodeKv.get<ServerCodeManifest>(manifestKey, 'json');

	if (!manifest) {
		return new Response('Server code not found', { status: 404 });
	}

	const { entrypoint, modules: moduleManifest, compatibilityDate, env = {} } = manifest;

	// Load all modules from KV by their content hashes and decode based on type
	const modules: Record<string, any> = {};
	await Promise.all(
		Object.entries(moduleManifest).map(async ([modulePath, { hash: contentHash, type }]) => {
			const moduleKey = getServerCodeKey(projectId, contentHash);
			const base64Content = await serverCodeKv.get(moduleKey, 'text');

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
				default:
					// Fallback to plain string for unknown types
					modules[modulePath] = new TextDecoder().decode(decodedBytes);
			}
		})
	);

	// Use content hash of the manifest as the worker key for caching
	const codeHash = await computeContentHash(new TextEncoder().encode(JSON.stringify(manifest)));

	const worker = loader.get(codeHash, () => {
		return {
			compatibilityDate: compatibilityDate || '2025-11-09',
			mainModule: entrypoint,
			modules,
			env: {
				...env,
				...bindings,
			},
			globalOutbound: null, // disable internet access
		};
	});

	const defaultEntrypoint = worker.getEntrypoint(undefined, {});

	return await defaultEntrypoint.fetch(request);
}
