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
