/**
 * Reads multiple keys from a KV namespace in parallel using individual
 * get() calls. Missing keys map to undefined in the returned Map.
 *
 * @param namespace - The KV namespace to read from
 * @param keys - The keys to read
 * @param options - KV get options (type and optional cacheTtl)
 * @returns A Map of key → value (missing keys map to undefined)
 */
export async function batchGetKv(
	namespace: KVNamespace,
	keys: string[],
	options: { type: 'text'; cacheTtl?: number },
): Promise<Map<string, string | undefined>>;
export async function batchGetKv(
	namespace: KVNamespace,
	keys: string[],
	options: { type: 'json'; cacheTtl?: number },
): Promise<Map<string, object | undefined>>;
export async function batchGetKv(
	namespace: KVNamespace,
	keys: string[],
	options?: { type?: 'text' | 'json'; cacheTtl?: number },
): Promise<Map<string, string | object | undefined>> {
	const promises = keys.map((key) =>
		options?.type === 'json'
			? namespace.get<object>(key, { type: 'json', cacheTtl: options.cacheTtl })
			: namespace.get(key, { type: 'text', cacheTtl: options?.cacheTtl }),
	);
	const results = await Promise.all(promises);

	const merged = new Map<string, string | object | undefined>();
	for (const [index, key] of keys.entries()) {
		const value = results[index];
		merged.set(key, value === null ? undefined : value);
	}

	return merged;
}

/**
 * Checks whether multiple keys exist in a KV namespace in parallel.
 * Uses get() with type:'stream' to avoid buffering full values into memory,
 * then immediately cancels each stream to release the underlying resource.
 *
 * @param namespace - The KV namespace to check
 * @param keys - The keys to check for existence
 * @returns A Set of keys that exist
 */
export async function batchExistsKv(namespace: KVNamespace, keys: string[]): Promise<Set<string>> {
	const promises = keys.map((key) => namespace.get(key, { type: 'stream' }));
	const results = await Promise.all(promises);

	const existing = new Set<string>();
	const cancellations: Promise<void>[] = [];
	for (const [index, key] of keys.entries()) {
		const stream = results[index];
		if (stream) {
			existing.add(key);
			// Cancel the stream to release the underlying resource
			cancellations.push(stream.cancel());
		}
	}
	await Promise.all(cancellations);

	return existing;
}

const KV_DELETE_BATCH_SIZE = 50;

/**
 * Deletes all keys matching a prefix from a KV namespace using parallel batches.
 *
 * @param namespace - The KV namespace to delete from
 * @param options - KV list options (typically includes prefix)
 * @param onKey - Optional callback invoked for each key before deletion
 * @returns The total number of keys deleted
 */
export async function deleteAllKeys(
	namespace: KVNamespace,
	options: KVNamespaceListOptions,
	onKey?: (key: KVNamespaceListKey<unknown, string>) => void,
): Promise<number> {
	let deleted = 0;
	let complete = false;
	let cursor: string | undefined;

	while (!complete) {
		const result = await namespace.list({
			...options,
			cursor,
		});

		// Delete in parallel batches
		for (let index = 0; index < result.keys.length; index += KV_DELETE_BATCH_SIZE) {
			const batch = result.keys.slice(index, index + KV_DELETE_BATCH_SIZE);
			await Promise.all(
				batch.map((key) => {
					onKey?.(key);
					return namespace.delete(key.name);
				}),
			);
			deleted += batch.length;
		}

		if (result.list_complete) {
			complete = true;
		} else {
			({ cursor } = result);
		}
	}

	return deleted;
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
