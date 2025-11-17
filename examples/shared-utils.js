import readline from 'node:readline';

let MANAGER_URL = null;
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
	if (MANAGER_URL && API_TOKEN) {
		return; // Already initialized
	}

	console.log('\n🔧 Configuration Setup\n');

	MANAGER_URL = await prompt('Enter the manager endpoint URL', 'http://127.0.0.1:8787');
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

	const response = await fetch(`${MANAGER_URL}/__api/projects`, {
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
 * Deploy an application (with or without server code)
 * @param {string} projectId - The project ID
 * @param {Object} deployment - Deployment configuration
 * @param {string} deployment.projectName - Project name
 * @param {Array} deployment.assets - Array of assets to deploy
 * @param {Object} [deployment.serverCode] - Optional server code configuration
 * @returns {Promise<Object>} Deployment result
 */
async function deployApplication(projectId, deployment) {
	await initConfig();

	const response = await fetch(`${MANAGER_URL}/__api/projects/${projectId}/deploy`, {
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
	console.log(`  - Assets deployed: ${result.deployedAssets}`);
	console.log(`  - New assets: ${result.newAssets}`);
	console.log(`  - Cached assets: ${result.skippedAssets}`);
	return result;
}

/**
 * List all projects
 * @returns {Promise<Array>} Array of projects
 */
async function listProjects() {
	await initConfig();

	const response = await fetch(`${MANAGER_URL}/__api/projects`, {
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
	if (!MANAGER_URL) {
		throw new Error('Configuration not initialized');
	}
	return `${MANAGER_URL}/__project/${projectId}/`;
}

export { MANAGER_URL, createProject, deployApplication, listProjects, getProjectUrl };
