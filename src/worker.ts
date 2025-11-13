import { AssetsManifest } from "./assets-manifest";
import { normalizeConfiguration } from "./configuration";
import { canFetch as handleCanFetch, handleRequest } from "./handler";
import { handleError } from "./utils/final-operations";
import { getAssetWithMetadataFromKV } from "./utils/kv";
import * as base64 from "@stablelib/base64";
import { WorkerEntrypoint } from "cloudflare:workers";

// Cache hit threshold in milliseconds
const KV_CACHE_HIT_THRESHOLD_MS = 100;

/*
 * The Asset Worker is set up as a `WorkerEntrypoint` class so that it is able
 * to accept RPC calls to any of its public methods. There are currently four
 * such public methods defined on this Worker: `canFetch`, `getByETag`,
 * `getByPathname` and `exists`.
 */
export default class extends WorkerEntrypoint<Env> {
	private _assetsManifest?: AssetsManifest;

	/**
	 * Lazy-load and cache the assets manifest
	 */
	private get assetsManifest(): AssetsManifest {
		if (!this._assetsManifest) {
			const manifestBuffer = base64.decode(this.env.ASSETS_MANIFEST);
			this._assetsManifest = new AssetsManifest(manifestBuffer);
		}
		return this._assetsManifest;
	}

	override async fetch(request: Request): Promise<Response> {
		try {
			const config = normalizeConfiguration(this.env.CONFIG);
			const response = await handleRequest(
				request,
				this.env,
				config,
				this.exists.bind(this),
				this.getByETag.bind(this)
			);

			return response;
		} catch (err) {
			return handleError(err);
		}
	}

	/**
	 * Check if the worker can fetch a given request
	 */
	async canFetch(request: Request): Promise<boolean> {
		return handleCanFetch(
			request,
			this.env,
			normalizeConfiguration(this.env.CONFIG),
			this.exists.bind(this)
		);
	}

	/**
	 * Fetch an asset by its eTag
	 */
	async getByETag(
		eTag: string,
		_request?: Request
	): Promise<{
		readableStream: ReadableStream;
		contentType: string | undefined;
		cacheStatus: "HIT" | "MISS";
	}> {
		const startTime = Date.now();
		const asset = await getAssetWithMetadataFromKV(
			this.env.ASSETS_KV_NAMESPACE,
			eTag
		);
		const endTime = Date.now();
		const assetFetchTime = endTime - startTime;

		if (!asset || !asset.value) {
			throw new Error(
				`Requested asset ${eTag} exists in the asset manifest but not in the KV namespace.`
			);
		}

		const cacheStatus =
			assetFetchTime <= KV_CACHE_HIT_THRESHOLD_MS ? "HIT" : "MISS";

		return {
			readableStream: asset.value,
			contentType: asset.metadata?.contentType,
			cacheStatus,
		};
	}

	/**
	 * Fetch an asset by its pathname
	 */
	async getByPathname(
		pathname: string,
		request?: Request
	): Promise<{
		readableStream: ReadableStream;
		contentType: string | undefined;
		cacheStatus: "HIT" | "MISS";
	} | null> {
		const eTag = await this.exists(pathname, request);

		if (!eTag) {
			return null;
		}

		return this.getByETag(eTag, request);
	}

	/**
	 * Check if an asset exists for the given pathname
	 * @returns The eTag if the asset exists, null otherwise
	 */
	async exists(pathname: string, _request?: Request): Promise<string | null> {
		const eTag = await this.assetsManifest.get(pathname);
		return eTag;
	}
}
