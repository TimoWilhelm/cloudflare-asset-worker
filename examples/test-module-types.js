/**
 * Test: Module type specification
 *
 * This example demonstrates:
 * 1. Different module types (js, cjs, text, json, data)
 * 2. Explicit type specification vs. auto-detection from extension
 * 3. Importing different module types including binary data
 */

import { createProject, deployApplication, getProjectUrl } from './shared-utils.js';

async function testModuleTypes() {
	try {
		console.log('Creating project...');
		const project = await createProject('Module Types Test');

		// Main ES module
		const mainModule = `import { greet } from './helpers.js';
import config from './config.json';
import template from './template.txt';
import binaryData from './data.bin';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/api/test') {
			// binaryData is an ArrayBuffer
			const dataView = new Uint8Array(binaryData);
			const dataHex = Array.from(dataView).map(b => b.toString(16).padStart(2, '0')).join(' ');

			return new Response(JSON.stringify({
				greeting: greet(config.appName),
				template: template,
				config: config,
				binaryData: {
					type: 'ArrayBuffer',
					byteLength: binaryData.byteLength,
					hex: dataHex
				},
				timestamp: new Date().toISOString()
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		return env.ASSETS.fetch(request);
	}
}`;

		// Helper module (ES module)
		const helpersModule = `export function greet(name) {
	return \`Hello from \${name}!\`;
}`;

		// Config as JSON module
		const configJson = {
			appName: 'Module Types Demo',
			version: '1.0.0',
			features: {
				json: true,
				text: true,
				multiModule: true
			}
		};

		// Template as text module
		const templateText = 'Welcome to {{appName}} - Version {{version}}';

		// Binary data as data module (ArrayBuffer)
		// Creating a small binary file with magic bytes and version info
		const binaryData = new Uint8Array([
			0x4D, 0x54, 0x59, 0x50, // Magic bytes: 'MTYP'
			0x01, 0x00, 0x00, 0x00, // Version: 1
			0xCA, 0xFE, 0xBA, 0xBE  // Signature bytes
		]);

		const htmlContent = `<!DOCTYPE html>
<html>
<head>
	<title>Module Types Test</title>
	<style>
		body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 1rem; }
		button { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
		pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow: auto; }
	</style>
	<meta charset="utf-8">
</head>
<body>
	<h1>Module Types Test</h1>
	<p>This demonstrates different module types:</p>
	<ul>
		<li><strong>index.js</strong> - ES Module (js)</li>
		<li><strong>helpers.js</strong> - ES Module (js)</li>
		<li><strong>config.json</strong> - JSON Module (json)</li>
		<li><strong>template.txt</strong> - Text Module (text)</li>
		<li><strong>data.bin</strong> - Binary Data Module (data → ArrayBuffer)</li>
	</ul>
	<button onclick="testAPI()">Test API</button>
	<div id="result"></div>

	<script>
		async function testAPI() {
			const result = document.getElementById('result');
			result.innerHTML = '<p>Loading...</p>';

			try {
				// Use relative path that works with both subdomain and path-based routing
				const response = await fetch('api/test');
				const data = await response.json();
				result.innerHTML = '<h3>Success! ✅</h3><pre>' +
					JSON.stringify(data, null, 2) + '</pre>';
			} catch (error) {
				result.innerHTML = '<h3>Error ❌</h3><p>' + error.message + '</p>';
			}
		}
	</script>
</body>
</html>`;

		console.log('\n=== DEPLOYING WITH MULTIPLE MODULE TYPES ===\n');

		await deployApplication(project.id, {
			projectName: 'Module Types Test',
			assets: [
				{
					pathname: '/index.html',
					content: Buffer.from(htmlContent, 'utf-8').toString('base64'),
					contentType: 'text/html',
				},
			],
			serverCode: {
				entrypoint: 'index.js',
				modules: {
					// Main module - type auto-detected from .js extension
					'index.js': Buffer.from(mainModule, 'utf-8').toString('base64'),

					// Helper module - type auto-detected from .js extension
					'helpers.js': Buffer.from(helpersModule, 'utf-8').toString('base64'),

					// Config - explicit JSON type (could also use .json extension)
					'config.json': {
						content: Buffer.from(JSON.stringify(configJson), 'utf-8').toString('base64'),
						type: 'json'
					},

					// Template - explicit text type (could also use .txt extension)
					'template.txt': {
						content: Buffer.from(templateText, 'utf-8').toString('base64'),
						type: 'text'
					},

					// Binary data - explicit data type (returns ArrayBuffer)
					'data.bin': {
						content: Buffer.from(binaryData).toString('base64'),
						type: 'data'
					}
				},
			},
			run_worker_first: ['/api/*'],
		});

		console.log('\n✅ Deployment complete!\n');
		console.log('Module types deployed:');
		console.log('  - index.js     → ES Module (auto-detected)');
		console.log('  - helpers.js   → ES Module (auto-detected)');
		console.log('  - config.json  → JSON Module (explicit)');
		console.log('  - template.txt → Text Module (explicit)');
		console.log('  - data.bin     → Binary Data Module (explicit → ArrayBuffer)\n');

		console.log('Test the deployment:');
		console.log(`  ${getProjectUrl(project.id)}`);
		console.log(`  ${getProjectUrl(project.id)}api/test\n`);

	} catch (error) {
		console.error('❌ Error:', error.message);
		console.error(error.stack);
		process.exit(1);
	}
}

testModuleTypes();
