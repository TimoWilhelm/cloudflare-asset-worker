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
				cacheTtl: 31_536_000, // 1 year
			});

			if (asset.value === null) {
				// Don't cache a 404 for a year by re-requesting with a minimum cacheTtl
				try {
					const retriedAsset = await assetsKVNamespace.getWithMetadata<AssetMetadata>(assetKey, {
						type: 'stream',
						cacheTtl: 60, // Minimum value allowed
					});

					return retriedAsset;
				} catch {
					// If the low-cacheTtl retry fails, return the original null result
					// rather than bypassing the outer retry loop
					return asset;
				}
			}
			return asset;
		} catch (error) {
			if (attempts >= retries) {
				let message = `KV GET ${assetKey} failed.`;
				if (error instanceof Error) {
					message = `KV GET ${assetKey} failed: ${error.message}`;
				}
				throw new Error(message);
			}

			// Exponential backoff, 1 second first time, then 2 seconds, then 4 seconds etc.
			await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.pow(2, attempts) * 1000));
			attempts++;
		}
	}

	// Unreachable: the loop always returns or throws, but TypeScript can't prove it
	throw new Error(`KV GET ${assetKey} failed after ${retries} retries.`);
}
