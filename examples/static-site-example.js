/**
 * Example: Deploy a static website (no server code)
 *
 * This demonstrates deploying a simple static site with HTML, CSS, and assets
 */

const MANAGER_URL = 'http://127.0.0.1:8787';

async function deployStaticSite() {
	try {
		// 1. Create project
		console.log('Creating project...');
		const createResponse = await fetch(`${MANAGER_URL}/__api/projects`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'My Static Site' }),
		});
		const { project } = await createResponse.json();
		console.log('✓ Project created:', project.id);

		// 2. Prepare static assets
		const assets = [
			{
				pathname: '/index.html',
				content: Buffer.from(`<!DOCTYPE html>
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
</html>`, 'utf-8').toString('base64'),
				contentType: 'text/html; charset=utf-8',
			},
			{
				pathname: '/styles.css',
				content: Buffer.from(`* {
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
}`, 'utf-8').toString('base64'),
				contentType: 'text/css',
			},
			{
				pathname: '/about.html',
				content: Buffer.from(`<!DOCTYPE html>
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
</html>`, 'utf-8').toString('base64'),
				contentType: 'text/html; charset=utf-8',
			},
		];

		// 3. Deploy (no server code)
		console.log('Deploying static assets...');
		const deployResponse = await fetch(
			`${MANAGER_URL}/__api/projects/${project.id}/deploy`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectName: 'My Static Site',
					assets,
					// Note: no serverCode property
				}),
			}
		);

		const result = await deployResponse.json();
		console.log('✓ Deployment complete!');
		console.log(`  - ${result.deployedAssets} assets deployed`);
		console.log(`  - ${result.newAssets} new, ${result.skippedAssets} cached`);

		console.log('\nAccess your site at:');
		console.log(`  ${MANAGER_URL}/__project/${project.id}/`);

	} catch (error) {
		console.error('❌ Error:', error.message);
		process.exit(1);
	}
}

// Run
deployStaticSite();
