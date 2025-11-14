import { WorkerEntrypoint } from 'cloudflare:workers';
import type AssetApi from '../../api/src/worker';
import type { ManifestEntry } from '../../api/src/worker';

export default class AssetManager extends WorkerEntrypoint<Env> {
	// Currently, entrypoints without a named handler are not supported
	override async fetch(request: Request) {
		const url = new URL(request.url);

		if (url.pathname === '/__api/upload') {
			return this.handleUpload();
		}

		// Forward all other requests to the API worker
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		const response = await assets.fetch(request);
		console.log(response, response.ok);

		if (response.status !== 404) {
			return response;
		}

		let worker = this.env.LOADER.get('my_worker_id', () => {
			return {
				compatibilityDate: '2025-11-09',

				mainModule: 'index.js',
				modules: {
					'index.js': `
						export default {
							async fetch(req, env, ctx) {
								return new Response('Hello from dynamic Worker!');
							}
						};
					`,
				},

				env: {},
				globalOutbound: null,
			};
		});

		let defaultEntrypoint = worker.getEntrypoint(undefined, {
			props: { name: 'Alice' },
		});

		return await defaultEntrypoint.fetch(request);
	}

	private async handleUpload(): Promise<Response> {
		try {
			const assets = this.env.ASSET_WORKER as Service<AssetApi>;

			// Create minimal index.html
			const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Asset Worker</title>
</head>
<body>
	<h1>Hello from Asset Worker!</h1>
</body>
</html>`;

			// Compute content hash (eTag) for the HTML file
			const htmlBuffer = new TextEncoder().encode(htmlContent);
			const contentHashBuffer = await crypto.subtle.digest('SHA-256', htmlBuffer);
			const contentHash = Array.from(new Uint8Array(contentHashBuffer))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');

			// Upload manifest as object array
			const manifestEntries: ManifestEntry[] = [
				{
					pathname: '/index.html',
					contentHash: contentHash,
				},
			];

			// Get list of new entries that need uploading
			const newEntries = await assets.uploadManifest(manifestEntries);

			// Only upload assets for new entries
			const skippedCount = manifestEntries.length - newEntries.length;
			if (skippedCount > 0) {
				console.log(`Skipping ${skippedCount} existing asset(s) that already exist in KV storage`);
			}

			for (const entry of newEntries) {
				if (entry.contentHash === contentHash) {
					await assets.uploadAsset(contentHash, htmlBuffer.buffer as ArrayBuffer, 'text/html; charset=utf-8');
				}
			}

			return new Response(
				JSON.stringify({
					success: true,
					message: 'Asset and manifest uploaded successfully',
					eTag: contentHash,
					newAssets: newEntries.length,
					totalAssets: manifestEntries.length,
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			return new Response(
				JSON.stringify({
					success: false,
					error: error instanceof Error ? error.message : 'Unknown error',
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}
}
