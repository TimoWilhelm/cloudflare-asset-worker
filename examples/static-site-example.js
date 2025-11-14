/**
 * Example: Deploy a static website (no server code)
 *
 * This demonstrates deploying a simple static site with HTML, CSS, and assets
 */

import { createProject, deployApplication, listProjects, getProjectUrl } from './shared-utils.js';

async function deployStaticSite() {
	try {
		// 1. Create project
		console.log('Creating project...');
		const project = await createProject('My Static Site');

		// 2. Prepare static assets
		console.log('\nPreparing deployment...');
		const assets = [
			{
				pathname: '/index.html',
				content: Buffer.from(
					`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Static Site</title>
	<link rel="stylesheet" href="/styles.css">
</head>
<body>
	<div class="container">
		<h1>Welcome to My Static Site</h1>
		<p>Deployed on Cloudflare Workers with KV storage</p>
	</div>
</body>
</html>`,
					'utf-8'
				).toString('base64'),
				contentType: 'text/html; charset=utf-8',
			},
			{
				pathname: '/styles.css',
				content: Buffer.from(
					`* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

body {
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	min-height: 100vh;
	display: flex;
	align-items: center;
	justify-content: center;
	color: white;
}

.container {
	text-align: center;
	padding: 2rem;
}

h1 {
	font-size: 3rem;
	margin-bottom: 1rem;
}

p {
	font-size: 1.2rem;
	opacity: 0.9;
}`,
					'utf-8'
				).toString('base64'),
				contentType: 'text/css',
			},
			{
				pathname: '/about.html',
				content: Buffer.from(
					`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>About</title>
	<link rel="stylesheet" href="/styles.css">
</head>
<body>
	<div class="container">
		<h1>About</h1>
		<p>This is a static site deployed using the multi-project platform</p>
		<p><a href="/" style="color: white;">← Back to Home</a></p>
	</div>
</body>
</html>`,
					'utf-8'
				).toString('base64'),
				contentType: 'text/html; charset=utf-8',
			},
		];

		// 3. Deploy (no server code)
		console.log('Deploying application...');
		await deployApplication(project.id, {
			projectName: 'My Static Site',
			assets,
			// Note: no serverCode property
		});

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

// Run
deployStaticSite();
