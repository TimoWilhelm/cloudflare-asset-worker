import { createManifest } from './utilities.js';

/**
 * API Client for Cloudflare Multi-Project Platform
 */
export class ApiClient {
	constructor(routerUrl, apiToken) {
		this.routerUrl = routerUrl.replace(/\/$/, ''); // Remove trailing slash
		this.apiToken = apiToken;
	}

	/**
	 * Create a new project
	 * @param {string} name - Project name
	 * @returns {Promise<Object>} Created project
	 */
	async createProject(name) {
		const response = await fetch(`${this.routerUrl}/__api/projects`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: this.apiToken,
			},
			body: JSON.stringify({ name }),
		});

		const result = await response.json();
		if (!result.success) {
			throw new Error(`Failed to create project: ${result.error}`);
		}

		return result.project;
	}

	/**
	 * Get project by ID
	 * @param {string} projectId - Project ID
	 * @returns {Promise<Object>} Project details
	 */
	async getProject(projectId) {
		const response = await fetch(`${this.routerUrl}/__api/projects/${projectId}`, {
			headers: {
				Authorization: this.apiToken,
			},
		});

		const result = await response.json();
		if (!result.success) {
			throw new Error(`Failed to get project: ${result.error}`);
		}

		return result.project;
	}

	/**
	 * List all projects
	 * @returns {Promise<Array>} List of projects
	 */
	async listProjects() {
		const response = await fetch(`${this.routerUrl}/__api/projects`, {
			headers: {
				Authorization: this.apiToken,
			},
		});

		const result = await response.json();
		if (!result.success) {
			throw new Error(`Failed to list projects: ${result.error}`);
		}

		return result.projects;
	}

	/**
	 * Phase 1: Create asset upload session
	 * @param {string} projectId - Project ID
	 * @param {Object} manifest - Asset manifest
	 * @returns {Promise<Object>} Upload session with JWT and buckets
	 */
	async createUploadSession(projectId, manifest) {
		const response = await fetch(`${this.routerUrl}/__api/projects/${projectId}/assets-upload-session`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: this.apiToken,
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
	 * Phase 2: Upload asset bucket
	 * @param {string} projectId - Project ID
	 * @param {string} uploadJwt - Upload JWT
	 * @param {Object} payload - Hash to content mapping
	 * @returns {Promise<Object>} Upload result
	 */
	async uploadAssetBucket(projectId, uploadJwt, payload) {
		const response = await fetch(`${this.routerUrl}/__api/projects/${projectId}/assets/upload`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${uploadJwt}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to upload assets: HTTP ${response.status} - ${errorText}`);
		}

		const data = await response.json();
		if (!data.success) {
			throw new Error(`Failed to upload assets: ${JSON.stringify(data.errors || data.error)}`);
		}

		return data.result;
	}

	/**
	 * Phase 3: Finalize deployment
	 * @param {string} projectId - Project ID
	 * @param {string} completionJwt - Completion JWT
	 * @param {Object} deployment - Deployment configuration
	 * @returns {Promise<Object>} Deployment result
	 */
	async finalizeDeployment(projectId, completionJwt, deployment) {
		const response = await fetch(`${this.routerUrl}/__api/projects/${projectId}/deploy`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: this.apiToken,
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
	 * Deploy application using three-phase upload flow
	 * @param {string} projectId - Project ID
	 * @param {Object} deployment - Deployment configuration
	 * @returns {Promise<Object>} Deployment result
	 */
	async deployApplication(projectId, deployment) {
		// If no assets, just deploy server code/config
		if (!deployment.assets || deployment.assets.length === 0) {
			const response = await fetch(`${this.routerUrl}/__api/projects/${projectId}/deploy`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: this.apiToken,
				},
				body: JSON.stringify(deployment),
			});

			const result = await response.json();
			if (!result.success) {
				throw new Error(`Failed to deploy: ${result.error}`);
			}

			return result;
		}

		// Phase 1: Create manifest
		console.log('\n📝 Phase 1: Creating asset manifest...');
		const manifest = createManifest(deployment.assets);
		console.log(`  Created manifest with ${Object.keys(manifest).length} files`);

		// Phase 2: Upload session
		console.log('\n🔄 Phase 2: Starting upload session...');
		const { jwt: sessionJwt, buckets } = await this.createUploadSession(projectId, manifest);

		// If no buckets, sessionJwt is already a completion token; otherwise it's an upload token
		let completionJwt = sessionJwt;

		if (buckets.length === 0) {
			console.log('  ✓ All assets cached, skipping upload');
		} else {
			const totalFiles = buckets.flat().length;
			console.log(`  Uploading ${buckets.length} bucket(s) with ${totalFiles} new files...`);

			// Upload each bucket
			for (let index = 0; index < buckets.length; index++) {
				const bucket = buckets[index];
				console.log(`  Uploading bucket ${index + 1}/${buckets.length} (${bucket.length} files)...`);

				// Create payload with base64 encoded files
				const payload = {};
				for (const hash of bucket) {
					// Find the asset with this hash
					const manifestEntry = Object.entries(manifest).find(([_, data]) => data.hash === hash);
					if (!manifestEntry) continue;
					const [pathname] = manifestEntry;
					const asset = deployment.assets.find((a) => a.pathname === pathname);
					if (asset) {
						payload[hash] = asset.content;
					}
				}

				const result = await this.uploadAssetBucket(projectId, sessionJwt, payload);
				if (result.jwt) {
					completionJwt = result.jwt;
				}
			}

			console.log('  ✓ All assets uploaded');
		}

		// Phase 3: Finalize
		console.log('\n🚀 Phase 3: Finalizing deployment...');
		const result = await this.finalizeDeployment(projectId, completionJwt, deployment);

		return result;
	}

	/**
	 * Check if router URL supports subdomain routing
	 * @returns {boolean} True if subdomain routing should be shown
	 */
	supportsSubdomainRouting() {
		try {
			const url = new URL(this.routerUrl);
			const hostname = url.hostname.toLowerCase();

			// Check if it's localhost
			if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
				return false;
			}

			// Check if it's an IP address (simple check for IPv4)
			if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
				return false;
			}

			// Check if it ends with workers.dev
			if (hostname.endsWith('.workers.dev')) {
				return false;
			}

			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get domain for subdomain routing
	 * @returns {string|null} Domain for subdomain routing or null
	 */
	getSubdomainRoutingDomain() {
		if (!this.supportsSubdomainRouting()) {
			return;
		}

		try {
			const url = new URL(this.routerUrl);
			const protocol = url.protocol === 'https:' ? 'https' : 'http';
			const hostname = url.hostname;
			const port = url.port ? `:${url.port}` : '';

			return `${protocol}://<projectId>.${hostname}${port}/`;
		} catch {
			return;
		}
	}

	/**
	 * Get project URL
	 * @param {string} projectId - Project ID
	 * @returns {string} Project URL
	 */
	getProjectUrl(projectId) {
		return `${this.routerUrl}/__project/${projectId}/`;
	}
}
