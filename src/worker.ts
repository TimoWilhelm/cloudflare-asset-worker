import { AssetsManifest } from './assets-manifest';
import { normalizeConfiguration } from './configuration';
import { canFetch as handleCanFetch, handleRequest } from './handler';
import { handleError } from './utils/final-operations';
import { getAssetWithMetadataFromKV } from './utils/kv';
import { WorkerEntrypoint } from 'cloudflare:workers';

// Cache hit threshold in milliseconds
const KV_CACHE_HIT_THRESHOLD_MS = 100;

export default class extends WorkerEntrypoint<Env> {
	private _assetsManifest?: AssetsManifest;

	/**
	 * Lazy-load and cache the assets manifest
	 */
	private async getAssetsManifest(): Promise<AssetsManifest> {
		if (!this._assetsManifest) {
			const manifestBuffer = await this.env.MANIFEST_KV_NAMESPACE.get<ArrayBuffer>('ASSETS_MANIFEST');
			if (!manifestBuffer) {
				throw new Error('Failed to load assets manifest');
			}
			this._assetsManifest = new AssetsManifest(new Uint8Array(manifestBuffer));
		}
		return this._assetsManifest;
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
	 * The manifest should be a binary buffer following the format:
	 * - 16 byte header
	 * - Entries (48 bytes each): 16 bytes path hash + 32 bytes content hash
	 * - Entries must be sorted by path hash
	 *
	 * @param manifestBuffer - The encoded manifest as ArrayBuffer
	 * @returns A promise that resolves when the upload is complete
	 */
	async uploadManifest(manifestBuffer: ArrayBuffer): Promise<void> {
		// Clear the cached manifest so it will be reloaded on next access
		this._assetsManifest = undefined;

		await this.env.MANIFEST_KV_NAMESPACE.put('ASSETS_MANIFEST', manifestBuffer);
	}
}
