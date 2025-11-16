/**
 * Example deployment script for the Cloudflare Multi-Project Deployment Platform
 *
 * This script demonstrates how to:
 * 1. Create a new project
 * 2. Deploy a full-stack application with assets and server code
 * 3. Use environment variables in server-side code
 * 4. Access the deployed application
 */

import { createProject, deployApplication, listProjects, getProjectUrl } from './shared-utils.js';

/**
 * Main deployment example
 */
async function main() {
	try {
		// 1. Create a new project
		console.log('Creating project...');
		const project = await createProject('My Full-Stack App');

		// 2. Prepare deployment
		console.log('\nPreparing deployment...');

		const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>My App</title>
	<link rel="stylesheet" href="style.css">
</head>
<body>
	<h1>Hello from Multi-Project Platform!</h1>
	<p>Project ID: ${project.id}</p>
	<button onclick="fetch('api/hello').then(r => r.json()).then(data => alert(JSON.stringify(data, null, 2)))">Test API</button>
	<button onclick="fetch('api/config').then(r => r.json()).then(data => alert(JSON.stringify(data, null, 2)))">Show Config</button>
</body>
</html>`;

		const cssContent = `body {
	font-family: system-ui, -apple-system, sans-serif;
	max-width: 800px;
	margin: 0 auto;
	padding: 2rem;
	background: #f5f5f5;
}

h1 {
	color: #f38020;
}

button {
	background: #f38020;
	color: white;
	border: none;
	padding: 0.5rem 1rem;
	border-radius: 4px;
	cursor: pointer;
	font-size: 1rem;
	margin-right: 0.5rem;
	margin-top: 0.5rem;
}

button:hover {
	background: #e06010;
}`;

		const serverCode = `export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// API endpoint - demonstrates basic functionality
		if (url.pathname === '/api/hello') {
			return new Response(JSON.stringify({
				message: 'Hello from server code!',
				environment: env.ENVIRONMENT || 'not set',
				timestamp: new Date().toISOString()
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Config endpoint - demonstrates environment variable usage
		if (url.pathname === '/api/config') {
			return new Response(JSON.stringify({
				environment: env.ENVIRONMENT || 'development',
				apiUrl: env.API_URL || 'not configured',
				appName: env.APP_NAME || 'My App',
				maxItems: parseInt(env.MAX_ITEMS_PER_PAGE || '10'),
				debugMode: env.DEBUG === 'true',
				featureNewUI: env.FEATURE_NEW_UI === 'true',
				version: env.VERSION || '1.0.0'
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Let assets handle other requests
		return new Response('Not found', { status: 404 });
	}
}`;

		const deployment = {
			projectName: 'My Full-Stack App',
			assets: [
				{
					pathname: '/index.html',
					content: Buffer.from(htmlContent, 'utf-8').toString('base64'),
					contentType: 'text/html; charset=utf-8',
				},
				{
					pathname: '/style.css',
					content: Buffer.from(cssContent, 'utf-8').toString('base64'),
					contentType: 'text/css',
				},
			],
			serverCode: {
				entrypoint: 'index.js',
				modules: {
					'index.js': serverCode,
				},
				compatibilityDate: '2025-11-09',
			},
			// Asset configuration
			config: {
				html_handling: 'auto-trailing-slash',
				not_found_handling: 'none',
			},
			// Run worker first for API routes to avoid unnecessary asset checks
			run_worker_first: ['/api/*'],
			// Environment variables for server code (non-secret config)
			env: {
				ENVIRONMENT: 'production',
				API_URL: 'https://api.example.com',
				APP_NAME: 'My Full-Stack App',
				MAX_ITEMS_PER_PAGE: '20',
				DEBUG: 'false',
				FEATURE_NEW_UI: 'true',
				VERSION: '1.0.0',
			},
		};

		// 3. Deploy
		console.log('Deploying application...');
		await deployApplication(project.id, deployment);

		// 4. Show access URLs
		console.log('\nAccess your application at:');
		console.log(`  Path-based: ${getProjectUrl(project.id)}`);
		console.log(`  Subdomain:  https://${project.id}.yourdomain.com/ (configure DNS)`);

		console.log('\nℹ️  Environment variables deployed:');
		Object.keys(deployment.env).forEach(key => {
			console.log(`  ${key}: ${deployment.env[key]}`);
		});
		console.log('\n💡 Try clicking "Test API" and "Show Config" buttons to see env vars in action!');

		// 5. List all projects
		console.log('\n--- All Projects ---');
		const projects = await listProjects();
		projects.forEach((p) => {
			console.log(`  - ${p.name} (${p.id})`);
			console.log(`    Assets: ${p.assetsCount}, Server: ${p.hasServerCode ? 'Yes' : 'No'}`);
		});
	} catch (error) {
		console.error('❌ Error:', error.message);
		process.exit(1);
	}
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
	main();
}
