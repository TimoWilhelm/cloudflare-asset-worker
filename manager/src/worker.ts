import { WorkerEntrypoint } from 'cloudflare:workers';
import type AssetApi from '../../api/src/worker';
import type { ManifestEntry } from '../../api/src/worker';

export default class AssetManager extends WorkerEntrypoint<Env> {
	// Currently, entrypoints without a named handler are not supported
	override async fetch(request: Request) {
		const url = new URL(request.url);

		if (url.pathname === '/api/upload') {
			return this.handleUpload();
		}

		// Forward all other requests to the API worker
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		return assets.fetch(request);
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
				.map(b => b.toString(16).padStart(2, '0'))
				.join('');

			// Upload the asset
			await assets.uploadAsset(contentHash, htmlBuffer.buffer as ArrayBuffer, 'text/html; charset=utf-8');

			// Upload manifest as object array
			const manifestEntries: ManifestEntry[] = [
				{
					pathname: '/index.html',
					contentHash: contentHash,
				},
			];
			await assets.uploadManifest(manifestEntries);

			return new Response(JSON.stringify({
				success: true,
				message: 'Asset and manifest uploaded successfully',
				eTag: contentHash,
			}), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (error) {
			return new Response(JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	}
}
