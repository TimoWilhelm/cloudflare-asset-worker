import templateText from './template.txt'; // text module
import configData from './sample.json'; // json module
import binaryData from './data.bin'; // data module
import wasmModule from './simple.wasm'; // wasm module

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// API endpoint - demonstrates server-side functionality and environment variables
		if (url.pathname === '/api/hello') {
			return new Response(
				JSON.stringify({
					message: 'Hello from server code!',
					appName: env.APP_NAME || 'Fullstack App',
					environment: env.ENVIRONMENT || 'development',
					apiUrl: env.API_URL || 'not configured',
					timestamp: new Date().toISOString(),
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Endpoint demonstrating text module import
		if (url.pathname === '/api/template') {
			// Process the template by replacing variables
			const processed = templateText
				.replace('{{appName}}', env.APP_NAME || 'Fullstack App')
				.replace('{{environment}}', env.ENVIRONMENT || 'development')
				.replace('{{apiUrl}}', env.API_URL || 'not configured');

			return new Response(processed, {
				headers: { 'Content-Type': 'text/plain' },
			});
		}

		// Endpoint demonstrating json module import
		if (url.pathname === '/api/config') {
			// Return the imported JSON configuration
			return new Response(
				JSON.stringify({
					...configData,
					loadedFrom: 'json module import',
					timestamp: new Date().toISOString(),
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Endpoint demonstrating data (binary) module import
		if (url.pathname === '/api/data') {
			return new Response(
				JSON.stringify({
					message: 'Binary data module imported',
					data: new Uint8Array(binaryData),
					dataPreview:
						binaryData instanceof ArrayBuffer ? `ArrayBuffer with ${binaryData.byteLength} bytes` : String(binaryData).substring(0, 100),
					timestamp: new Date().toISOString(),
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Endpoint demonstrating wasm module import
		if (url.pathname === '/api/wasm') {
			const importObject = {
				imports: {
					imported_func: (arg) => {
						console.log(`Hello from JavaScript: ${arg}`);
					},
				},
			};
			const instance = await WebAssembly.instantiate(wasmModule, importObject);

			const retval = instance.exports.exported_func(42);
			return new Response(JSON.stringify({ message: 'Wasm module imported', retval }));
		}

		// Let assets handle other requests
		return new Response('Not found', { status: 404 });
	},
};
