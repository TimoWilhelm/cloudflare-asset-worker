/**
 * Scoped cache helper for KV get requests using the Workers Cache API.
 *
 * This module provides a caching layer in front of KV reads to reduce
 * latency and KV read costs. The cache is scoped by a cache name to
 * avoid collisions between different KV namespaces or data types.
 *
 * Inspired by https://github.com/helloimalastair/FlareUtils/blob/main/src/BetterKV/index.ts
 */

/** Default TTL for Cache API responses (in seconds) */
const DEFAULT_CACHE_TTL = 60;

/** Default TTL for KV's internal cache (in seconds) - 1 year */
const DEFAULT_KV_CACHE_TTL = 31557600;

/**
 * Options for the cached KV get operation.
 */
export interface CachedKvGetOptions {
	/** Cache API TTL in seconds. Defaults to 60 seconds. */
	cacheTtl?: number;
	/** KV's internal cache TTL in seconds. Defaults to 1 year. */
	kvCacheTtl?: number;
	/** Type of value to parse from KV. Defaults to 'text'. */
	type?: 'text' | 'json';
}

/**
 * Generates a cache-compatible URL key for a given KV key.
 * The Cache API requires a valid URL as the cache key.
 *
 * @param key - The KV key
 * @returns A synthetic URL to use as the cache key
 */
function getCacheKey(key: string): string {
	return `https://kv-cache.internal/${encodeURIComponent(key)}`;
}

/**
 * Gets a value from KV with caching via the Workers Cache API.
 * Results are cached at the edge to reduce KV read latency and costs.
 *
 * Uses two levels of caching:
 * 1. Workers Cache API - fast edge-level cache with configurable TTL
 * 2. KV's built-in cacheTtl - KV's internal caching mechanism
 *
 * @param kv - The KV namespace to read from
 * @param key - The key to read
 * @param scope - A scope/cache name to prevent cache key collisions (e.g., 'projects', 'server-code')
 * @param options - Optional cache configuration
 * @returns The cached or freshly-fetched value, or null if not found
 *
 * @example
 * ```ts
 * // Get a project from KV with caching
 * const project = await cachedKvGet<ProjectMetadata>(
 *   env.KV_PROJECTS,
 *   `project:${projectId}`,
 *   'projects',
 *   { type: 'json', cacheTtl: 120 }
 * );
 * ```
 */
export async function cachedKvGet<T = string>(
	kv: KVNamespace,
	key: string,
	scope: string,
	options: CachedKvGetOptions = {},
): Promise<T | null> {
	const { cacheTtl = DEFAULT_CACHE_TTL, kvCacheTtl = DEFAULT_KV_CACHE_TTL, type = 'text' } = options;

	const cacheKey = getCacheKey(key);
	const cache = await caches.open(scope);

	// Try to get from Cache API first
	const cachedResponse = await cache.match(cacheKey);
	if (cachedResponse) {
		// Cache hit - parse and return the cached value
		const text = await cachedResponse.text();
		// Handle the null case stored as literal "null" string
		if (text === 'null') {
			return null;
		}
		if (type === 'json') {
			return JSON.parse(text) as T;
		}
		return text as T;
	}

	// Cache miss - fetch from KV with KV's built-in cacheTtl
	let value: string | null;
	if (type === 'json') {
		const jsonValue = await kv.get<T>(key, { type: 'json', cacheTtl: kvCacheTtl });
		// Store the JSON stringified, including null
		value = JSON.stringify(jsonValue);
		// Cache in the Cache API
		await cacheValue(cache, cacheKey, value, cacheTtl);
		return jsonValue;
	} else {
		value = await kv.get(key, { type: 'text', cacheTtl: kvCacheTtl });
		// Cache in the Cache API (store "null" string for null values)
		await cacheValue(cache, cacheKey, value ?? 'null', cacheTtl);
		return value as T | null;
	}
}

/**
 * Stores a value in the cache with the specified TTL.
 *
 * @param cache - The cache instance
 * @param cacheKey - The cache key URL
 * @param value - The string value to cache
 * @param ttl - The TTL in seconds
 */
async function cacheValue(cache: Cache, cacheKey: string, value: string, ttl: number): Promise<void> {
	const response = new Response(value, {
		headers: {
			'Content-Type': 'text/plain',
			'Cache-Control': `public, max-age=${ttl}`,
		},
	});
	await cache.put(cacheKey, response);
}

/**
 * Invalidates a cached KV entry.
 * Call this after writing to KV to ensure the cache is consistent.
 *
 * @param scope - The scope/cache name used when caching
 * @param key - The KV key to invalidate
 * @returns true if the entry was deleted, false if it wasn't in the cache
 *
 * @example
 * ```ts
 * // After updating a project, invalidate its cache entry
 * await projectsKv.put(`project:${projectId}`, JSON.stringify(project));
 * await invalidateKvCache('projects', `project:${projectId}`);
 * ```
 */
export async function invalidateKvCache(scope: string, key: string): Promise<boolean> {
	const cacheKey = getCacheKey(key);
	const cache = await caches.open(scope);
	return cache.delete(cacheKey);
}
