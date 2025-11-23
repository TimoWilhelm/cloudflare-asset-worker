import readline from 'node:readline';
import crypto from 'crypto';

let ORCHESTRATOR_URL = null;
let API_TOKEN = null;

/**
 * Prompt user for input
 * @param {string} question - The question to ask
 * @param {string} defaultValue - Default value if user presses enter
 * @returns {Promise<string>} User's input
 */
function prompt(question, defaultValue = '') {
	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		const displayQuestion = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;

		rl.question(displayQuestion, (answer) => {
			rl.close();
			resolve(answer.trim() || defaultValue);
		});
	});
}

/**
 * Initialize configuration by prompting user
 */
async function initConfig() {
	if (ORCHESTRATOR_URL && API_TOKEN) {
		return; // Already initialized
	}

	console.log('\n🔧 Configuration Setup\n');

	ORCHESTRATOR_URL = await prompt('Enter the orchestrator endpoint URL', 'http://127.0.0.1:8787');
	API_TOKEN = await prompt('Enter the API token');

	if (!API_TOKEN) {
		throw new Error('API token is required');
	}

	console.log('\n✓ Configuration complete\n');
}

/**
 * Create a new project
 * @param {string} name - The name of the project
 * @returns {Promise<Object>} The created project object
 */
async function createProject(name) {
	await initConfig();

	const response = await fetch(`${ORCHESTRATOR_URL}/__api/projects`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': API_TOKEN,
		},
		body: JSON.stringify({ name }),
	});

	const result = await response.json();
	if (!result.success) {
		throw new Error(`Failed to create project: ${result.error}`);
	}

	console.log('✓ Project created:', result.project.id);
	return result.project;
}

/**
 * Create manifest from assets array
 * @param {Array} assets - Array of asset objects
 * @returns {Object} Manifest object
 */
function createManifestFromAssets(assets) {
	const manifest = {};
	for (const asset of assets) {
		// Decode base64 to compute hash
		const content = Buffer.from(asset.content, 'base64');
		const hash = crypto.createHash('sha256').update(content).digest('hex');
		manifest[asset.pathname] = {
			hash,
			size: content.length,
		};
	}
	return manifest;
}

/**
 * Phase 1: Create asset upload session
 * @param {string} projectId - The project ID
 * @param {Object} manifest - The asset manifest
 * @returns {Promise<Object>} Upload session with JWT and buckets
 */
async function createUploadSession(projectId, manifest) {
	const response = await fetch(`${ORCHESTRATOR_URL}/__api/projects/${projectId}/assets-upload-session`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': API_TOKEN,
		},
		body: JSON.stringify({ manifest }),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Failed to create upload session: HTTP ${response.status} - ${errorText}`);
	}

	const data = await response.json();
	if (!data.success) {
		throw new Error(`Failed to create upload session: ${JSON.stringify(data.errors || data.error)}`);
	}

	return data.result;
}

/**
 * Phase 2: Upload assets in buckets
 * @param {string} projectId - The project ID
 * @param {string} uploadJwt - Upload JWT from session
 * @param {Array} buckets - Array of hash buckets to upload
 * @param {Object} manifest - The asset manifest
 * @param {Array} assets - Original assets array
 * @returns {Promise<string>} Completion JWT
 */
async function uploadAssetBuckets(projectId, uploadJwt, buckets, manifest, assets) {
	if (buckets.length === 0) {
		// All assets cached, JWT is already completion token
		return uploadJwt;
	}

	let completionJwt = null;

	for (let i = 0; i < buckets.length; i++) {
		const bucket = buckets[i];
		console.log(`  Uploading bucket ${i + 1}/${buckets.length} (${bucket.length} files)...`);

		// Create payload with base64 encoded files
		const payload = {};
		for (const hash of bucket) {
			// Find the asset with this hash
			const [pathname] = Object.entries(manifest).find(([_, data]) => data.hash === hash);
			const asset = assets.find(a => a.pathname === pathname);
			if (asset) {
				payload[hash] = asset.content;
			}
		}

		const response = await fetch(`${ORCHESTRATOR_URL}/__api/projects/${projectId}/assets/upload`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${uploadJwt}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to upload bucket ${i + 1}: HTTP ${response.status} - ${errorText}`);
		}

		const data = await response.json();
		if (!data.success) {
			throw new Error(`Failed to upload bucket ${i + 1}: ${JSON.stringify(data.errors || data.error)}`);
		}

		if (data.result.jwt) {
			completionJwt = data.result.jwt;
		}
	}

	if (!completionJwt) {
		throw new Error('Upload completed but no completion JWT received');
	}

	return completionJwt;
}

/**
 * Phase 3: Deploy with completion JWT
 * @param {string} projectId - The project ID
 * @param {string} completionJwt - Completion JWT from upload
 * @param {Object} deployment - Additional deployment config
 * @returns {Promise<Object>} Deployment result
 */
async function finalizeDeployment(projectId, completionJwt, deployment) {
	const response = await fetch(`${ORCHESTRATOR_URL}/__api/projects/${projectId}/deploy`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': API_TOKEN,
		},
		body: JSON.stringify({
			completionJwt,
			projectName: deployment.projectName,
			serverCode: deployment.serverCode,
			config: deployment.config,
			run_worker_first: deployment.run_worker_first,
			env: deployment.env,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Failed to deploy: HTTP ${response.status} - ${errorText}`);
	}

	const result = await response.json();
	if (!result.success) {
		throw new Error(`Failed to deploy: ${result.error || JSON.stringify(result.errors)}`);
	}

	return result;
}

/**
 * Deploy an application using the three-phase upload flow
 * @param {string} projectId - The project ID
 * @param {Object} deployment - Deployment configuration
 * @param {string} deployment.projectName - Project name
 * @param {Array} deployment.assets - Array of assets to deploy (content should be base64-encoded)
 * @param {Object} [deployment.serverCode] - Optional server code configuration
 * @param {string} deployment.serverCode.entrypoint - Main module filename (e.g., 'index.js')
 * @param {Object} deployment.serverCode.modules - Module name to base64-encoded content mapping
 * @param {Object} [deployment.config] - Optional asset configuration
 * @param {boolean|Array} [deployment.run_worker_first] - Optional routing config
 * @param {Object} [deployment.env] - Optional environment variables
 * @returns {Promise<Object>} Deployment result
 *
 * @example
 * // Server code modules must be base64-encoded for transfer:
 * await deployApplication(projectId, {
 *   assets: [{ pathname: '/index.html', content: Buffer.from(html).toString('base64') }],
 *   serverCode: {
 *     entrypoint: 'index.js',
 *     modules: {
 *       'index.js': Buffer.from(code).toString('base64')  // Must be base64
 *     }
 *   }
 * });
 */
async function deployApplication(projectId, deployment) {
	await initConfig();

	if (!deployment.assets || deployment.assets.length === 0) {
		// No assets to deploy, just update server code/config
		const response = await fetch(`${ORCHESTRATOR_URL}/__api/projects/${projectId}/deploy`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': API_TOKEN,
			},
			body: JSON.stringify(deployment),
		});

		const result = await response.json();
		if (!result.success) {
			throw new Error(`Failed to deploy: ${result.error}`);
		}

		console.log('✓ Deployment complete!');
		return result;
	}

	console.log('\n📝 Phase 1: Creating asset manifest...');
	const manifest = createManifestFromAssets(deployment.assets);
	console.log(`  Created manifest with ${Object.keys(manifest).length} files`);

	console.log('\n🔄 Phase 2: Starting upload session...');
	const { jwt: uploadJwt, buckets } = await createUploadSession(projectId, manifest);

	if (buckets.length === 0) {
		console.log('  ✓ All assets cached, skipping upload');
	} else {
		console.log(`  Uploading ${buckets.length} bucket(s) with ${buckets.flat().length} new files...`);
	}

	const completionJwt = await uploadAssetBuckets(projectId, uploadJwt, buckets, manifest, deployment.assets);

	if (buckets.length > 0) {
		console.log('  ✓ All assets uploaded');
	}

	console.log('\n🚀 Phase 3: Finalizing deployment...');
	const result = await finalizeDeployment(projectId, completionJwt, deployment);

	console.log('\n✓ Deployment complete!');
	console.log(`  - Assets deployed: ${result.deployedAssets}`);
	console.log(`  - New assets: ${result.newAssets}`);
	console.log(`  - Cached assets: ${result.skippedAssets}`);

	if (result.deployedServerCodeModules) {
		console.log(`  - Server code modules: ${result.deployedServerCodeModules}`);
	}

	return result;
}

/**
 * List all projects
 * @returns {Promise<Array>} Array of projects
 */
async function listProjects() {
	await initConfig();

	const response = await fetch(`${ORCHESTRATOR_URL}/__api/projects`, {
		headers: {
			'Authorization': API_TOKEN,
		},
	});
	const result = await response.json();

	if (!result.success) {
		throw new Error(`Failed to list projects: ${result.error}`);
	}

	return result.projects;
}

/**
 * Get the access URL for a project
 * @param {string} projectId - The project ID
 * @returns {string} The project URL
 */
function getProjectUrl(projectId) {
	if (!ORCHESTRATOR_URL) {
		throw new Error('Configuration not initialized');
	}
	return `${ORCHESTRATOR_URL}/__project/${projectId}/`;
}

export { ORCHESTRATOR_URL, createProject, deployApplication, listProjects, getProjectUrl };
