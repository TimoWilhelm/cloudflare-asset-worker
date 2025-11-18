/**
 * Test: Re-deploy to verify asset caching optimization
 *
 * This script deploys twice to the same project to verify that
 * the second deployment skips uploading unchanged assets.
 */

import { createProject, deployApplication, getProjectUrl } from './shared-utils.js';

async function testRedeployment() {
	try {
		// 1. Create project ONCE
		console.log('Creating project...');
		const project = await createProject('Test Asset Caching');

		// 2. Prepare static assets
		const assets = [
			{
				pathname: '/index.html',
				content: Buffer.from('<h1>Test</h1>', 'utf-8').toString('base64'),
				contentType: 'text/html',
			},
			{
				pathname: '/styles.css',
				content: Buffer.from('body { margin: 0; }', 'utf-8').toString('base64'),
				contentType: 'text/css',
			},
			{
				pathname: '/app.js',
				content: Buffer.from('console.log("hello");', 'utf-8').toString('base64'),
				contentType: 'application/javascript',
			},
		];

		// 3. First deployment
		console.log('\n=== FIRST DEPLOYMENT ===');
		await deployApplication(project.id, {
			projectName: 'Test Asset Caching',
			assets,
		});

		// 4. Second deployment (same assets, should be cached)
		console.log('\n\n=== SECOND DEPLOYMENT (should skip uploads) ===');
		await deployApplication(project.id, {
			projectName: 'Test Asset Caching',
			assets, // Same exact assets
		});

		console.log('\n✅ Test complete!');
		console.log('If optimization works correctly, the second deployment should show:');
		console.log('  "✓ All assets cached, skipping upload"');
		console.log(`\nAccess: ${getProjectUrl(project.id)}`);

	} catch (error) {
		console.error('❌ Error:', error.message);
		process.exit(1);
	}
}

testRedeployment();
