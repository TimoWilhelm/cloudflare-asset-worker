const KV_BATCH_GET_LIMIT = 100;

/**
 * Reads multiple keys from a KV namespace, automatically chunking into
 * batches of 100 (the KV batch-get limit).
 *
 * @param namespace - The KV namespace to read from
 * @param keys - The keys to read (may exceed 100)
 * @param options - KV get options (type and optional cacheTtl). Only 'text' and 'json' types are supported by the batch API.
 * @returns A Map of key → value (missing keys map to null)
 */
export async function batchGetKv(
	namespace: KVNamespace,
	keys: string[],
	options: { type: 'text'; cacheTtl?: number },
): Promise<Map<string, string | null>>;
export async function batchGetKv(
	namespace: KVNamespace,
	keys: string[],
	options: { type: 'json'; cacheTtl?: number },
): Promise<Map<string, object | null>>;
export async function batchGetKv(
	namespace: KVNamespace,
	keys: string[],
	options?: { type?: 'text' | 'json'; cacheTtl?: number },
): Promise<Map<string, string | object | null>> {
	const merged = new Map<string, string | object | null>();

	for (let i = 0; i < keys.length; i += KV_BATCH_GET_LIMIT) {
		const batch = keys.slice(i, i + KV_BATCH_GET_LIMIT);
		const results = await namespace.get(batch, options as any);
		for (const [key, value] of results) {
			merged.set(key, value);
		}
	}

	return merged;
}

/**
 * Lists all keys in a KV namespace with automatic pagination.
 *
 * @param namespace - The KV namespace to list keys from
 * @param options - KV list options including prefix and limit
 * @yields Each key in the namespace matching the options
 */
export async function* listAllKeys<TMetadata, TKey extends string = string>(
	namespace: KVNamespace<TKey>,
	options: KVNamespaceListOptions,
): AsyncGenerator<KVNamespaceListKey<TMetadata, TKey>, void, undefined> {
	let complete = false;
	let cursor: string | undefined;

	while (!complete) {
		// eslint-disable-next-line no-await-in-loop
		const result = await namespace.list<TMetadata>({
			...options,
			cursor,
		});

		yield* result.keys;

		if (result.list_complete) {
			complete = true;
		} else {
			({ cursor } = result);
		}
	}
}
