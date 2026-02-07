import { AssetsManifest, hashPath } from './assets-manifest';
import { normalizeConfiguration, type AssetConfigInput } from './configuration';
import { canFetch as handleCanFetch, handleRequest } from './handler';
import { getAssetWithMetadataFromKV, listAllKeys } from './utils/kv';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { ENTRY_SIZE, HEADER_SIZE, PATH_HASH_SIZE } from './constants';
import { Analytics } from './analytics';
import { InternalServerErrorResponse } from './utils/responses';

export interface ManifestEntry {
	pathname: string;
	contentHash: string;
}

// Cache hit threshold in milliseconds
const KV_CACHE_HIT_THRESHOLD_MS = 100;

export default class AssetApi extends WorkerEntrypoint<Env> {
	public override async fetch(request: Request): Promise<Response> {
		return new Response('Not Found', { status: 404 });
	}

	/**
	 * Generates a namespaced key by prefixing with the project ID.
	 */
	private getNamespacedKey(projectId: string, key: string): string {
		return `project/${projectId}/asset/${key}`;
	}

	private async getAssetsManifest(projectId: string): Promise<AssetsManifest> {
		const manifestKey = `project/${projectId}/manifest`;
		const manifestBuffer = await this.env.KV_ASSETS.get(manifestKey, 'arrayBuffer');
		if (!manifestBuffer) {
			throw new Error(`Failed to load assets manifest for project ${projectId}`);
		}
		return new AssetsManifest(new Uint8Array(manifestBuffer));
	}

	/**
	 * Serves a static asset for the given request and project.
	 *
	 * @param request - The incoming HTTP request (already rewritten for path-based routing)
	 * @param projectId - The project ID for namespaced asset storage
	 * @param projectConfig - Optional configuration for HTML handling, redirects, etc.
	 * @returns Response containing the requested asset or an error response
	 */
	async serveAsset(request: Request, projectId: string, projectConfig?: AssetConfigInput): Promise<Response> {
		const startTime = performance.now();

		const analytics = new Analytics();

		const userAgent = request.headers.get('user-agent') ?? 'UA UNKNOWN';
		const coloRegion = request.cf?.colo as string;

		const url = new URL(request.url);

		analytics.setData({
			projectId,
			coloRegion,
			userAgent,
			hostname: url.hostname,
			htmlHandling: projectConfig?.html_handling,
			notFoundHandling: projectConfig?.not_found_handling,
		});

		try {
			const config = normalizeConfiguration(projectConfig);

			const response = await handleRequest(
				request,
				config,
				(pathname: string, req: Request) => this.exists(pathname, req, projectId),
				(eTag: string, req?: Request) => this.getByETag(eTag, projectId, req),
				analytics,
			);

			analytics.setData({
				status: response.status,
			});

			return response;
		} catch (err) {
			try {
				if (err instanceof Error) {
					analytics.setData({ error: err.message });
				}

				return new InternalServerErrorResponse(err);
			} catch (e) {
				console.error('Error handling error', e);
				return new InternalServerErrorResponse(e);
			}
		} finally {
			analytics.setData({
				requestTime: performance.now() - startTime,
			});
			analytics.write();
		}
	}

	/**
	 * Checks if the worker can serve a request based on the asset manifest.
	 *
	 * @param request - The HTTP request to check
	 * @param projectId - The project ID for namespaced asset storage
	 * @param projectConfig - Optional configuration for asset resolution
	 * @returns True if an asset exists for this request, false otherwise
	 */
	async canFetch(request: Request, projectId: string, projectConfig?: AssetConfigInput): Promise<boolean> {
		try {
			const config = normalizeConfiguration(projectConfig);
			return await handleCanFetch(request, config, (pathname: string, req: Request) => this.exists(pathname, req, projectId));
		} catch (e) {
			console.error('Error in canFetch RPC method:', e);
			if (e instanceof Error) {
				throw new Error(`Asset Service canFetch failed: ${e.message}`);
			}
			throw new Error(`Asset Service canFetch failed with unknown error: ${String(e)}`);
		}
	}

	/**
	 * Retrieves an asset by its eTag (content hash) from KV storage with Workers Cache layer.
	 *
	 * @param eTag - The content hash of the asset to retrieve
	 * @param projectId - The project ID for namespaced asset storage
	 * @param _request - Optional request object (currently unused)
	 * @returns Object containing the asset's readable stream, content type, cache status, and asset source
	 * @throws Error if the asset exists in the manifest but not in KV storage
	 */
	async getByETag(
		eTag: string,
		projectId: string,
		_request?: Request,
	): Promise<{
		readableStream: ReadableStream;
		contentType: string | undefined;
		cacheStatus: 'HIT' | 'MISS';
		fetchTimeMs: number;
	}> {
		const startTime = performance.now();
		const namespacedETag = this.getNamespacedKey(projectId, eTag);
		const asset = await getAssetWithMetadataFromKV(this.env.KV_ASSETS, namespacedETag);
		const endTime = performance.now();
		const assetFetchTime = endTime - startTime;

		if (!asset || !asset.value) {
			throw new Error(`Requested asset ${eTag} exists in the asset manifest but not in the KV namespace for project ${projectId}.`);
		}

		const cacheStatus = assetFetchTime <= KV_CACHE_HIT_THRESHOLD_MS ? 'HIT' : 'MISS';

		return {
			readableStream: asset.value,
			contentType: asset.metadata?.contentType,
			cacheStatus,
			fetchTimeMs: assetFetchTime,
		};
	}

	/**
	 * Retrieves an asset by its pathname, resolving it through the manifest.
	 *
	 * @param pathname - The URL pathname of the asset (e.g., "/index.html")
	 * @param request - Request object for manifest lookup
	 * @param projectId - The project ID for namespaced asset storage
	 * @returns Object containing the asset's readable stream, content type, and cache status, or null if not found
	 */
	async getByPathname(
		pathname: string,
		request: Request,
		projectId: string,
	): Promise<{
		readableStream: ReadableStream;
		contentType: string | undefined;
		cacheStatus: 'HIT' | 'MISS';
		fetchTimeMs: number;
	} | null> {
		const eTag = await this.exists(pathname, request, projectId);

		if (!eTag) {
			return null;
		}

		return this.getByETag(eTag, projectId, request);
	}

	/**
	 * Checks if an asset exists for the given pathname in the manifest.
	 *
	 * @param pathname - The URL pathname to look up (e.g., "/index.html")
	 * @param request - Request object (reserved for future use)
	 * @param projectId - The project ID for namespaced asset storage
	 * @returns The eTag (content hash) if the asset exists, null otherwise
	 */
	async exists(pathname: string, request: Request, projectId: string): Promise<string | null> {
		const manifest = await this.getAssetsManifest(projectId);
		const eTag = await manifest.get(pathname);
		return eTag;
	}

	/**
	 * Uploads an asset file to KV storage with optional content type metadata.
	 *
	 * @param eTag - The content hash used as the KV key
	 * @param content - The asset content as ArrayBuffer or ReadableStream
	 * @param projectId - The project ID for namespaced asset storage
	 * @param contentType - Optional MIME type (e.g., "text/html", "image/png")
	 */
	async uploadAsset(eTag: string, content: ArrayBuffer | ReadableStream, projectId: string, contentType?: string): Promise<void> {
		const metadata = contentType ? { contentType } : undefined;
		const namespacedETag = this.getNamespacedKey(projectId, eTag);

		await this.env.KV_ASSETS.put(namespacedETag, content, { metadata });
	}

	/**
	 * Uploads the assets manifest to KV storage as a binary buffer.
	 *
	 * The manifest format is: 16-byte header + sorted entries (48 bytes each:
	 * 16-byte path hash + 32-byte content hash).
	 *
	 * @param entries - Array of manifest entries with pathname and contentHash
	 * @param projectId - The project ID for namespaced asset storage
	 * @returns Array of entries that need to be uploaded (content not yet in KV)
	 */
	async uploadManifest(entries: ManifestEntry[], projectId: string): Promise<ManifestEntry[]> {
		// Validate entries
		for (const entry of entries) {
			// Validate content hash: must be 64 hex characters (SHA-256 = 32 bytes = 64 hex chars)
			if (!/^[0-9a-f]{64}$/i.test(entry.contentHash)) {
				throw new Error(`Invalid content hash for ${entry.pathname}: must be 64 hexadecimal characters`);
			}

			// Validate pathname: must start with /, not be empty, and contain valid URL path characters
			if (!entry.pathname || !entry.pathname.startsWith('/')) {
				throw new Error(`Invalid pathname "${entry.pathname}": must start with /`);
			}

			// Check for invalid characters in pathname
			if (/[\s<>{}|\\^`\[\]]/.test(entry.pathname)) {
				throw new Error(`Invalid pathname "${entry.pathname}": contains invalid URL characters`);
			}
		}

		// Check which etags already exist in KV storage
		const existenceChecks = await Promise.all(
			entries.map(async (entry) => {
				const namespacedETag = this.getNamespacedKey(projectId, entry.contentHash);
				const exists = await this.env.KV_ASSETS.get(namespacedETag, 'stream');
				return { entry, exists: exists !== null };
			}),
		);

		// Filter to only entries that need uploading
		const newEntries = existenceChecks.filter(({ exists }) => !exists).map(({ entry }) => entry);

		// Generate binary manifest
		const manifestBuffer = await this.generateManifestBuffer(entries);

		const manifestKey = `project/${projectId}/manifest`;
		await this.env.KV_ASSETS.put(manifestKey, manifestBuffer);

		return newEntries;
	}

	/**
	 * Generates a binary manifest buffer from an array of entries.
	 */
	private async generateManifestBuffer(entries: ManifestEntry[]): Promise<ArrayBuffer> {
		// Compute hashes for all entries
		const hashedEntries = await Promise.all(
			entries.map(async (entry) => {
				const pathHash = await hashPath(entry.pathname);
				const contentHashBytes = new Uint8Array(entry.contentHash.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
				return { pathHash, contentHashBytes };
			}),
		);

		// Sort entries by path hash
		hashedEntries.sort((a, b) => {
			for (let i = 0; i < PATH_HASH_SIZE; i++) {
				const diff = a.pathHash[i]! - b.pathHash[i]!;
				if (diff !== 0) return diff;
			}
			return 0;
		});

		// Create manifest buffer: header + entries
		const manifestSize = HEADER_SIZE + entries.length * ENTRY_SIZE;
		const manifest = new Uint8Array(manifestSize);

		// Write entries (path hash + content hash)
		hashedEntries.forEach((entry, index) => {
			const offset = HEADER_SIZE + index * ENTRY_SIZE;
			manifest.set(entry.pathHash, offset);
			manifest.set(entry.contentHashBytes, offset + PATH_HASH_SIZE);
		});

		return manifest.buffer as ArrayBuffer;
	}

	/**
	 * Checks if multiple assets exist in KV storage by their content hashes.
	 *
	 * @param eTags - Array of content hashes to check
	 * @param projectId - The project ID for namespaced asset storage
	 * @returns Array of objects with hash and exists boolean for each input
	 */
	async checkAssetsExist(eTags: string[], projectId: string): Promise<Array<{ hash: string; exists: boolean }>> {
		const results = await Promise.all(
			eTags.map(async (hash) => {
				const namespacedKey = this.getNamespacedKey(projectId, hash);
				const exists = await this.env.KV_ASSETS.get(namespacedKey, 'stream');
				return { hash, exists: exists !== null };
			}),
		);
		return results;
	}

	/**
	 * Deletes all assets and manifest for a project from KV storage.
	 *
	 * @param projectId - The project ID to delete assets for
	 * @returns Object with counts of deleted assets and manifest status
	 */
	async deleteProjectAssets(projectId: string): Promise<{ deletedAssets: number; deletedManifest: boolean }> {
		let deletedAssets = 0;
		let deletedManifest = false;

		// List all keys with the project prefix in KV_ASSETS
		const assetPrefix = `project/${projectId}/`;

		const manifestKey = `project/${projectId}/manifest`;

		// Delete all assets using listAllKeys for pagination
		for await (const key of listAllKeys(this.env.KV_ASSETS, { prefix: assetPrefix })) {
			await this.env.KV_ASSETS.delete(key.name);
			if (key.name === manifestKey) {
				deletedManifest = true;
			} else {
				deletedAssets++;
			}
		}

		return { deletedAssets, deletedManifest };
	}
}
