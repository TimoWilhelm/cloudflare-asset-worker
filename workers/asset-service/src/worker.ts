import { WorkerEntrypoint } from 'cloudflare:workers';

import { Analytics } from './analytics';
import { AssetsManifest, hashPath } from './assets-manifest';
import { normalizeConfiguration, type AssetConfigInput } from './configuration';
import { ENTRY_SIZE, HEADER_SIZE, PATH_HASH_SIZE } from './constants';
import { canFetch as handleCanFetch, handleRequest } from './handler';
import { getAssetWithMetadataFromKV } from './utils/kv';
import { InternalServerErrorResponse } from './utils/responses';
import { batchExistsKv, deleteAllKeys } from '../../shared/kv';

export interface ManifestEntry {
	pathname: string;
	contentHash: string;
}

// Cache hit threshold in milliseconds
const KV_CACHE_HIT_THRESHOLD_MS = 100;

export interface AssetEnvironment {
	KV_ASSETS: KVNamespace;
	ANALYTICS: AnalyticsEngineDataset;
	VERSION: WorkerVersionMetadata;
}

export default class AssetApi extends WorkerEntrypoint<AssetEnvironment> {
	public override async fetch(_request: Request): Promise<Response> {
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
		const manifestBuffer = await this.env.KV_ASSETS.get(manifestKey, { type: 'arrayBuffer', cacheTtl: 300 });
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
		const coloRegion = String(request.cf?.colo ?? '');

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
				(pathname: string, request_: Request) => this.exists(pathname, request_, projectId),
				(eTag: string, request_?: Request) => this.getByETag(eTag, projectId, request_),
				analytics,
			);

			analytics.setData({
				status: response.status,
			});

			return response;
		} catch (error) {
			try {
				if (error instanceof Error) {
					analytics.setData({ error: error.message });
				}

				return new InternalServerErrorResponse(error);
			} catch (error) {
				console.error('Error handling error', error);
				return new InternalServerErrorResponse(error);
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
			return await handleCanFetch(request, config, (pathname: string, request_: Request) => this.exists(pathname, request_, projectId));
		} catch (error) {
			console.error('Error in canFetch RPC method:', error);
			if (error instanceof Error) {
				throw new Error(`Asset Service canFetch failed: ${error.message}`);
			}
			throw new Error(`Asset Service canFetch failed with unknown error: ${String(error)}`);
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
	): Promise<
		| {
				readableStream: ReadableStream;
				contentType: string | undefined;
				cacheStatus: 'HIT' | 'MISS';
				fetchTimeMs: number;
		  }
		| undefined
	> {
		const eTag = await this.exists(pathname, request, projectId);

		if (!eTag) {
			return;
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
	async exists(pathname: string, request: Request, projectId: string): Promise<string | undefined> {
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
			if (/[\s<>{}|\\^`[\]]/.test(entry.pathname)) {
				throw new Error(`Invalid pathname "${entry.pathname}": contains invalid URL characters`);
			}
		}

		// Check which etags already exist in KV storage using batch get (max 100 keys per call)
		const namespacedEntries = entries.map((entry) => ({
			entry,
			namespacedKey: this.getNamespacedKey(projectId, entry.contentHash),
		}));

		const allKeys = namespacedEntries.map(({ namespacedKey }) => namespacedKey);
		const existingKeys = await batchExistsKv(this.env.KV_ASSETS, allKeys);
		const existenceChecks = namespacedEntries.map(({ entry, namespacedKey }) => ({
			entry,
			exists: existingKeys.has(namespacedKey),
		}));

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
				const hexPairs = entry.contentHash.match(/.{2}/g);
				if (!hexPairs) {
					throw new Error(`Invalid content hash format for ${entry.pathname}`);
				}
				const contentHashBytes = new Uint8Array(hexPairs.map((byte) => Number.parseInt(byte, 16)));
				return { pathHash, contentHashBytes };
			}),
		);

		// Sort entries by path hash
		hashedEntries.sort((a, b) => {
			for (let index = 0; index < PATH_HASH_SIZE; index++) {
				const diff = a.pathHash[index]! - b.pathHash[index]!;
				if (diff !== 0) return diff;
			}
			return 0;
		});

		// Create manifest buffer: header + entries
		const manifestSize = HEADER_SIZE + entries.length * ENTRY_SIZE;
		const manifest = new Uint8Array(manifestSize);

		// Write header: version (4 bytes) + entry count (4 bytes) + reserved (8 bytes)
		const headerView = new DataView(manifest.buffer, manifest.byteOffset, manifest.byteLength);
		headerView.setUint32(0, 1, false); // version 1, big-endian
		headerView.setUint32(4, entries.length, false); // entry count, big-endian

		// Write entries (path hash + content hash)
		for (const [index, entry] of hashedEntries.entries()) {
			const offset = HEADER_SIZE + index * ENTRY_SIZE;
			manifest.set(entry.pathHash, offset);
			manifest.set(entry.contentHashBytes, offset + PATH_HASH_SIZE);
		}

		return manifest.buffer.slice(manifest.byteOffset, manifest.byteOffset + manifest.byteLength);
	}

	/**
	 * Checks if multiple assets exist in KV storage by their content hashes.
	 *
	 * @param eTags - Array of content hashes to check
	 * @param projectId - The project ID for namespaced asset storage
	 * @returns Array of objects with hash and exists boolean for each input
	 */
	async checkAssetsExist(eTags: string[], projectId: string): Promise<Array<{ hash: string; exists: boolean }>> {
		const namespacedKeys = eTags.map((hash) => ({
			hash,
			key: this.getNamespacedKey(projectId, hash),
		}));

		const existingKeys = await batchExistsKv(
			this.env.KV_ASSETS,
			namespacedKeys.map(({ key }) => key),
		);

		return namespacedKeys.map(({ hash, key }) => ({
			hash,
			exists: existingKeys.has(key),
		}));
	}

	/**
	 * Deletes all assets and manifest for a project from KV storage.
	 *
	 * @param projectId - The project ID to delete assets for
	 * @returns Object with counts of deleted assets and manifest status
	 */
	async deleteProjectAssets(projectId: string): Promise<{ deletedAssets: number; deletedManifest: boolean }> {
		let deletedManifest = false;
		const manifestKey = `project/${projectId}/manifest`;
		const assetPrefix = `project/${projectId}/`;

		const totalDeleted = await deleteAllKeys(this.env.KV_ASSETS, { prefix: assetPrefix }, (key) => {
			if (key.name === manifestKey) {
				deletedManifest = true;
			}
		});

		// Subtract 1 for the manifest key if it was found
		const deletedAssets = deletedManifest ? totalDeleted - 1 : totalDeleted;

		return { deletedAssets, deletedManifest };
	}
}
