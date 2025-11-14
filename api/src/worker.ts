import { AssetsManifest, hashPath } from './assets-manifest';
import { normalizeConfiguration } from './configuration';
import { canFetch as handleCanFetch, handleRequest } from './handler';
import { handleError } from './utils/final-operations';
import { getAssetWithMetadataFromKV } from './utils/kv';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { ENTRY_SIZE, HEADER_SIZE, PATH_HASH_SIZE } from './lib/constants';

export interface ManifestEntry {
	pathname: string;
	contentHash: string;
}

// Cache hit threshold in milliseconds
const KV_CACHE_HIT_THRESHOLD_MS = 100;

export default class AssetApi extends WorkerEntrypoint<Env> {
	private async getAssetsManifest(): Promise<AssetsManifest> {
		const manifestBuffer = await this.env.MANIFEST_KV_NAMESPACE.get('ASSETS_MANIFEST', 'arrayBuffer');
		if (!manifestBuffer) {
			throw new Error('Failed to load assets manifest');
		}
		return new AssetsManifest(new Uint8Array(manifestBuffer));
	}

	/**
	 * Handles incoming HTTP requests to serve static assets
	 * @param request - The incoming HTTP request
	 * @returns A Response object with the requested asset or an error response
	 */
	override async fetch(request: Request): Promise<Response> {
		try {
			const config = normalizeConfiguration(this.env.CONFIG);
			const response = await handleRequest(request, this.env, config, this.exists.bind(this), this.getByETag.bind(this));

			return response;
		} catch (err) {
			return handleError(err);
		}
	}

	/**
	 * Check if the worker can fetch a given request based on the configuration and asset manifest
	 * @param request - The HTTP request to check
	 * @returns True if the worker can handle this request, false otherwise
	 */
	async canFetch(request: Request): Promise<boolean> {
		return handleCanFetch(request, this.env, normalizeConfiguration(this.env.CONFIG), this.exists.bind(this));
	}

	/**
	 * Fetch an asset by its eTag (content hash) from KV storage
	 * @param eTag - The content hash of the asset to retrieve
	 * @param _request - Optional request object (currently unused)
	 * @returns An object containing the asset's readable stream, content type, and cache status
	 * @throws Error if the asset exists in the manifest but not in KV storage
	 */
	async getByETag(
		eTag: string,
		_request?: Request
	): Promise<{
		readableStream: ReadableStream;
		contentType: string | undefined;
		cacheStatus: 'HIT' | 'MISS';
	}> {
		const startTime = performance.now();
		const asset = await getAssetWithMetadataFromKV(this.env.ASSETS_KV_NAMESPACE, eTag);
		const endTime = performance.now();
		const assetFetchTime = endTime - startTime;

		if (!asset || !asset.value) {
			throw new Error(`Requested asset ${eTag} exists in the asset manifest but not in the KV namespace.`);
		}

		const cacheStatus = assetFetchTime <= KV_CACHE_HIT_THRESHOLD_MS ? 'HIT' : 'MISS';

		return {
			readableStream: asset.value,
			contentType: asset.metadata?.contentType,
			cacheStatus,
		};
	}

	/**
	 * Fetch an asset by its pathname by first resolving the pathname to an eTag
	 * @param pathname - The URL pathname of the asset (e.g., "/index.html")
	 * @param request - Optional request object passed to exists() and getByETag()
	 * @returns An object containing the asset's readable stream, content type, and cache status, or null if not found
	 */
	async getByPathname(
		pathname: string,
		request?: Request
	): Promise<{
		readableStream: ReadableStream;
		contentType: string | undefined;
		cacheStatus: 'HIT' | 'MISS';
	} | null> {
		const eTag = await this.exists(pathname, request);

		if (!eTag) {
			return null;
		}

		return this.getByETag(eTag, request);
	}

	/**
	 * Check if an asset exists for the given pathname in the manifest
	 * @param pathname - The URL pathname to look up (e.g., "/index.html")
	 * @param _request - Optional request object (currently unused)
	 * @returns The eTag (content hash) if the asset exists, null otherwise
	 */
	async exists(pathname: string, _request?: Request): Promise<string | null> {
		const manifest = await this.getAssetsManifest();
		const eTag = await manifest.get(pathname);
		return eTag;
	}

	/**
	 * Upload an asset file to KV storage with optional metadata
	 * @param eTag - The eTag (content hash) that will be used as the key in KV
	 * @param content - The asset content as ArrayBuffer or ReadableStream
	 * @param contentType - Optional MIME type of the asset (e.g., "text/html", "image/png")
	 * @returns A promise that resolves when the upload is complete
	 */
	async uploadAsset(eTag: string, content: ArrayBuffer | ReadableStream, contentType?: string): Promise<void> {
		const metadata = contentType ? { contentType } : undefined;

		await this.env.ASSETS_KV_NAMESPACE.put(eTag, content, { metadata });
	}

	/**
	 * Upload the assets manifest to KV storage and clear the cached manifest
	 *
	 * The manifest will be encoded into a binary buffer following the format:
	 * - 16 byte header
	 * - Entries (48 bytes each): 16 bytes path hash + 32 bytes content hash
	 * - Entries are sorted by path hash
	 *
	 * @param entries - Array of manifest entries with pathname and contentHash
	 * @returns Array of ManifestEntry objects that need to be uploaded (entries whose contentHash doesn't exist in KV)
	 */
	async uploadManifest(entries: ManifestEntry[]): Promise<ManifestEntry[]> {
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
				const exists = await this.env.ASSETS_KV_NAMESPACE.list({ prefix: entry.contentHash });
				return { entry, exists: exists.keys.length > 0 };
			})
		);

		// Filter to only entries that need uploading
		const newEntries = existenceChecks.filter(({ exists }) => !exists).map(({ entry }) => entry);

		// Generate binary manifest
		const manifestBuffer = await this.generateManifestBuffer(entries);

		await this.env.MANIFEST_KV_NAMESPACE.put('ASSETS_MANIFEST', manifestBuffer);

		return newEntries;
	}

	/**
	 * Generate a binary manifest buffer from an array of entries
	 * @param entries - Array of manifest entries
	 * @returns The encoded manifest as ArrayBuffer
	 */
	private async generateManifestBuffer(entries: ManifestEntry[]): Promise<ArrayBuffer> {
		// Compute hashes for all entries
		const hashedEntries = await Promise.all(
			entries.map(async (entry) => {
				const pathHash = await hashPath(entry.pathname);
				const contentHashBytes = new Uint8Array(entry.contentHash.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
				return { pathHash, contentHashBytes };
			})
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
}
