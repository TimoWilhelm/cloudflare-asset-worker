export type AssetMetadata = {
	contentType: string;
};

/**
 * Retrieves an asset with metadata from KV storage with retry support.
 *
 * @param assetsKVNamespace - The KV namespace containing assets
 * @param assetKey - The key of the asset to retrieve
 * @param retries - Number of retry attempts on failure (default: 1)
 * @returns The asset value and metadata, or null if not found
 * @throws Error if all retry attempts fail
 */
export async function getAssetWithMetadataFromKV(assetsKVNamespace: KVNamespace, assetKey: string, retries = 1) {
	let attempts = 0;

	while (attempts <= retries) {
		try {
			const asset = await assetsKVNamespace.getWithMetadata<AssetMetadata>(assetKey, {
				type: 'stream',
				cacheTtl: 31536000, // 1 year
			});

			if (asset.value === null) {
				// Don't cache a 404 for a year by re-requesting with a minimum cacheTtl
				const retriedAsset = await assetsKVNamespace.getWithMetadata<AssetMetadata>(assetKey, {
					type: 'stream',
					cacheTtl: 60, // Minimum value allowed
				});

				return retriedAsset;
			}
			return asset;
		} catch (err) {
			if (attempts >= retries) {
				let message = `KV GET ${assetKey} failed.`;
				if (err instanceof Error) {
					message = `KV GET ${assetKey} failed: ${err.message}`;
				}
				throw new Error(message);
			}

			// Exponential backoff, 1 second first time, then 2 second, then 4 second etc.
			await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.pow(2, attempts++) * 1000));
		}
	}
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
