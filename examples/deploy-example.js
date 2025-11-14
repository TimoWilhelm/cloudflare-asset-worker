/**
 * Example deployment script for the Cloudflare Multi-Project Deployment Platform
 *
 * This script demonstrates how to:
 * 1. Create a new project
 * 2. Deploy a full-stack application with assets and server code
 * 3. Access the deployed application
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
	<link rel="stylesheet" href="/style.css">
</head>
<body>
	<h1>Hello from Multi-Project Platform!</h1>
	<p>Project ID: ${project.id}</p>
	<button onclick="fetch('/api/hello').then(r => r.text()).then(alert)">Test API</button>
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
}

button:hover {
	background: #e06010;
}`;

		const serverCode = `export default {
	async fetch(request) {
		const url = new URL(request.url);

		// API endpoint
		if (url.pathname === '/api/hello') {
			return new Response(JSON.stringify({
				message: 'Hello from server code!',
				timestamp: new Date().toISOString()
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
		};

		// 3. Deploy
		console.log('Deploying application...');
		await deployApplication(project.id, deployment);

		// 4. Show access URLs
		console.log('\nAccess your application at:');
		console.log(`  Path-based: ${getProjectUrl(project.id)}`);
		console.log(`  Subdomain:  https://${project.id}.yourdomain.com/ (configure DNS)`);

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
