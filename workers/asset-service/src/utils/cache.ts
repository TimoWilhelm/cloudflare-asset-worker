import { getAssetWithMetadataFromKV, type AssetMetadata } from './kv';

/** Default TTL for Workers Cache API asset responses (in seconds) */
const DEFAULT_ASSET_CACHE_TTL = 3600; // 1 hour

/**
 * Asset source indicating where the asset was retrieved from.
 */
export type AssetSource = 'CACHE' | 'ORIGIN';

/**
 * Result of a cached asset fetch including source information.
 */
export interface CachedAssetResult {
	value: ReadableStream;
	metadata: AssetMetadata | null;
	source: AssetSource;
	/** Time in milliseconds for the fetch operation */
	fetchTimeMs: number;
}

/**
 * Generates a cache-compatible URL key for a given asset key.
 * The Cache API requires a valid URL as the cache key.
 */
function getAssetCacheKey(assetKey: string): string {
	return `https://asset-cache.internal/${encodeURIComponent(assetKey)}`;
}

/**
 * Retrieves an asset with Workers Cache API layer in front of KV storage.
 * Results are cached at the edge to reduce KV read latency and costs.
 *
 * @param assetsKVNamespace - The KV namespace containing assets
 * @param assetKey - The key of the asset to retrieve
 * @param cacheTtl - TTL for the Workers Cache in seconds (default: 1 hour)
 * @returns The asset with source and timing information, or null if not found
 */
export async function cachedAssetGet(
	assetsKVNamespace: KVNamespace,
	assetKey: string,
	cacheTtl: number = DEFAULT_ASSET_CACHE_TTL,
): Promise<CachedAssetResult | null> {
	const startTime = performance.now();
	const cacheKey = getAssetCacheKey(assetKey);
	const cache = await caches.open('asset-content');

	// Try Workers Cache API first
	const cachedResponse = await cache.match(cacheKey);
	if (cachedResponse) {
		const endTime = performance.now();
		const contentType = cachedResponse.headers.get('X-Asset-Content-Type') || undefined;
		return {
			value: cachedResponse.body!,
			metadata: contentType ? { contentType } : null,
			source: 'CACHE',
			fetchTimeMs: endTime - startTime,
		};
	}

	// Cache miss - fetch from KV with timing
	const asset = await getAssetWithMetadataFromKV(assetsKVNamespace, assetKey);
	const endTime = performance.now();
	const fetchTimeMs = endTime - startTime;

	if (!asset || !asset.value) {
		return null;
	}

	// Clone the stream so we can cache one copy and return the other
	const [streamForCache, streamForReturn] = asset.value.tee();

	// Store in Workers Cache
	const responseToCache = new Response(streamForCache, {
		headers: {
			'Content-Type': asset.metadata?.contentType || 'application/octet-stream',
			'X-Asset-Content-Type': asset.metadata?.contentType || '',
			'Cache-Control': `public, max-age=${cacheTtl}`,
		},
	});

	// Use waitUntil pattern if available, otherwise don't block on cache.put
	cache.put(cacheKey, responseToCache).catch(() => {
		// Silently ignore cache put errors
	});

	return {
		value: streamForReturn,
		metadata: asset.metadata,
		source: 'ORIGIN',
		fetchTimeMs,
	};
}
