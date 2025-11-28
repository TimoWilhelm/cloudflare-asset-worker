/**
 * Analytics data schema for the Orchestrator worker.
 *
 * Dataset name: orchestrator (configured in wrangler.jsonc)
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

	// -- Blobs --
	// blob1 - Hostname of the request
	hostname?: string;
	// blob2 - User agent making the request
	userAgent?: string;
	// blob3 - Request pathname
	pathname?: string;
	// blob4 - Error message
	error?: string;
	// blob5 - Three-letter IATA airport code of the data center (e.g. WEUR)
	coloRegion?: string;
	// blob6 - Whether the request used path-based routing
	routingType?: string;
	// blob7 - Request method (GET, POST, etc.)
	method?: string;
	// blob8 - Request type (asset, script, etc.)
	requestType?: string;
};

export class Analytics {
	private data: Data = {};

	constructor(private readonly analyticsEngineDataset?: AnalyticsEngineDataset) {}

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
			doubles: [this.data.requestTime ?? -1, this.data.status ?? -1],
			blobs: [
				this.data.hostname?.substring(0, 256) ?? null,
				this.data.userAgent?.substring(0, 256) ?? null,
				this.data.pathname?.substring(0, 256) ?? null,
				this.data.error?.substring(0, 256) ?? null,
				this.data.coloRegion ?? null,
				this.data.routingType ?? null,
				this.data.method ?? null,
				this.data.requestType ?? null,
			],
		});
	}
}
