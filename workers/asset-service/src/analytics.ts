import { env } from 'cloudflare:workers';

/**
 * Analytics data schema for the Asset Service worker.
 *
 * Dataset name: asset_service (configured in wrangler.jsonc)
 *
 * IMPORTANT: If you modify this schema, you MUST also update:
 * - ../../ANALYTICS-GUIDE.md (Data Schema section)
 */
type Data = {
	// -- Indexes --
	projectId?: string;

	// -- Doubles --
	// double1 - The time it takes for the whole request to complete in milliseconds
	requestTime?: number;
	// double2 - Response status code
	status?: number;
	// double3 - Time in milliseconds to fetch the asset (from cache or KV)
	fetchTimeMs?: number;

	// -- Blobs --
	// blob1 - Hostname of the request
	hostname?: string;
	// blob2 - User agent making the request
	userAgent?: string;
	// blob3 - Html handling option
	htmlHandling?: string;
	// blob4 - Not found handling option
	notFoundHandling?: string;
	// blob5 - Error message
	error?: string;
	// blob6 - The current version UUID of asset-worker
	workerVersion?: string;
	// blob7 - Three-letter IATA airport code of the data center (e.g. WEUR)
	coloRegion?: string;
	// blob8 - The cache status of the request
	cacheStatus?: string;
};

export class Analytics {
	private readonly analyticsEngineDataset = env.ANALYTICS;
	private data: Data = { workerVersion: env.VERSION.id };

	constructor() {}

	setData(newData: Partial<Data>) {
		this.data = { ...this.data, ...newData };
	}

	getData(key: keyof Data) {
		return this.data[key];
	}

	write() {
		if (!this.analyticsEngineDataset) {
			return;
		}
		this.analyticsEngineDataset.writeDataPoint({
			indexes: [this.data.projectId ?? null],
			doubles: [this.data.requestTime ?? -1, this.data.status ?? -1, this.data.fetchTimeMs ?? -1],
			blobs: [
				this.data.hostname?.slice(0, 256) ?? null,
				this.data.userAgent?.slice(0, 256) ?? null,
				this.data.htmlHandling ?? null,
				this.data.notFoundHandling ?? null,
				this.data.error?.slice(0, 256) ?? null,
				this.data.workerVersion ?? null,
				this.data.coloRegion ?? null,
				this.data.cacheStatus ?? null,
			],
		});
	}
}
