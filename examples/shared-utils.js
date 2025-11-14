const MANAGER_URL = 'http://127.0.0.1:8787';

/**
 * Create a new project
 * @param {string} name - The name of the project
 * @returns {Promise<Object>} The created project object
 */
async function createProject(name) {
	const response = await fetch(`${MANAGER_URL}/__api/projects`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
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
	const response = await fetch(`${MANAGER_URL}/__api/projects/${projectId}/deploy`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
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
	const response = await fetch(`${MANAGER_URL}/__api/projects`);
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
	return `${MANAGER_URL}/__project/${projectId}/`;
}

export { MANAGER_URL, createProject, deployApplication, listProjects, getProjectUrl };
