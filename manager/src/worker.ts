import { WorkerEntrypoint } from 'cloudflare:workers';
import type AssetApi from '../../api/src/worker';
import type { ManifestEntry } from '../../api/src/worker';
import type { AssetConfig } from '../../api/src/configuration';
import { minimatch } from 'minimatch';
import { Hono } from 'hono';

interface ProjectMetadata {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	hasServerCode: boolean;
	assetsCount: number;
	config?: AssetConfig;
	run_worker_first?: boolean | string[];
}

interface ServerCodeManifest {
	entrypoint: string;
	// Map of module path to content hash
	modules: Record<string, string>;
	compatibilityDate?: string;
	env?: Record<string, string>;
}

interface DeploymentPayload {
	projectName?: string;
	assets: {
		pathname: string;
		content: string; // Base64 encoded
		contentType?: string;
	}[];
	serverCode?: {
		entrypoint: string;
		modules: Record<string, string>;
		compatibilityDate?: string;
	};
	config?: AssetConfig;
	run_worker_first?: boolean | string[];
	env?: Record<string, string>;
}

export class AssetBinding extends WorkerEntrypoint<Env, { projectId: string; config?: AssetConfig }> {
	override async fetch(request: Request): Promise<Response> {
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		return await assets.serveAsset(request, this.ctx.props.projectId, this.ctx.props.config);
	}
}

export default class AssetManager extends WorkerEntrypoint<Env> {
	/**
	 * Check if a pathname matches glob patterns using minimatch
	 * @param pathname - The pathname to check
	 * @param patterns - Array of glob patterns to match against
	 * @returns True if pathname matches any pattern
	 */
	private matchesGlobPatterns(pathname: string, patterns: string[]): boolean {
		for (const pattern of patterns) {
			if (minimatch(pathname, pattern)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Determine if worker should run first based on config and pathname
	 * @param config - The run_worker_first configuration
	 * @param pathname - The request pathname
	 * @returns True if worker should run first
	 */
	private shouldRunWorkerFirst(config: boolean | string[] | undefined, pathname: string): boolean {
		if (config === undefined || config === false) {
			return false;
		}

		if (config === true) {
			return true;
		}

		// If config is string[], check if pathname matches any pattern
		return this.matchesGlobPatterns(pathname, config);
	}

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Management API routes
		if (url.pathname.startsWith('/__api/')) {
			const app = new Hono<{ Bindings: Env }>();

			// Authentication middleware - validate API_TOKEN
			app.use('/__api/*', async (c, next) => {
				const authHeader = c.req.header('Authorization');
				const apiToken = c.env.API_TOKEN;

				if (!apiToken) {
					return c.json(
						{
							success: false,
							error: 'API_TOKEN not configured',
						},
						500
					);
				}

				if (!authHeader || authHeader !== apiToken) {
					return c.json(
						{
							success: false,
							error: 'Unauthorized: Invalid or missing Authorization header',
						},
						401
					);
				}

				await next();
			});

			app.post('/__api/projects', async (c) => {
				return this.createProject(c.req.raw);
			});

			app.get('/__api/projects', async (c) => {
				return this.listProjects();
			});

			app.get('/__api/projects/:projectId', async (c) => {
				const projectId = c.req.param('projectId');
				return this.getProjectInfo(projectId);
			});

			app.delete('/__api/projects/:projectId', async (c) => {
				const projectId = c.req.param('projectId');
				return this.deleteProject(projectId);
			});

			app.post('/__api/projects/:projectId/deploy', async (c) => {
				const projectId = c.req.param('projectId');
				return this.deployProject(projectId, c.req.raw);
			});

			app.onError((err, c) => {
				return c.json(
					{
						success: false,
						error: err instanceof Error ? err.message : 'Unknown error',
					},
					500
				);
			});

			return app.fetch(request, this.env);
		}

		// Project serving - extract project ID from subdomain or path
		const { projectId, isPathBased } = this.extractProjectId(url);

		if (!projectId) {
			return new Response('Project not found. Access via subdomain (project-id.domain.com) or path (/__project/project-id/)', {
				status: 404,
			});
		}

		// Verify project exists
		const project = await this.getProject(projectId);
		if (!project) {
			return new Response('Project not found', { status: 404 });
		}

		// Rewrite request URL if using path-based routing
		let rewrittenRequest = request;
		if (isPathBased) {
			rewrittenRequest = this.rewriteRequestUrl(request, projectId);
		}

		// Decide whether to check assets first or run worker first based on config
		const rewrittenUrl = new URL(rewrittenRequest.url);
		const runWorkerFirst = this.shouldRunWorkerFirst(project.run_worker_first, rewrittenUrl.pathname);

		if (runWorkerFirst && project.hasServerCode) {
			// Run server code first, let it handle everything including static files
			return this.runServerCode(rewrittenRequest, projectId, project.config);
		}

		// Try to serve static assets first (default behavior)
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;

		const canServeAsset = await assets.canFetch(rewrittenRequest, projectId, project.config);

		if (canServeAsset) {
			return await assets.serveAsset(rewrittenRequest, projectId, project.config);
		}

		// If no asset found and project has server code, run dynamic worker
		if (project.hasServerCode) {
			return this.runServerCode(rewrittenRequest, projectId, project.config);
		}

		return new Response('Not found', { status: 404 });
	}

	/**
	 * Extract project ID from subdomain or path
	 * Returns both the project ID and whether path-based routing is used
	 */
	private extractProjectId(url: URL): { projectId: string | null; isPathBased: boolean } {
		// Check for path-based routing: /__project/project-id/...
		if (url.pathname.startsWith('/__project/')) {
			const parts = url.pathname.split('/');
			return {
				projectId: parts[2] || null,
				isPathBased: true,
			};
		}

		// Check for subdomain-based routing: project-id.domain.com
		const subdomain = url.hostname.split('.')[0];
		if (subdomain && subdomain !== 'www' && !url.hostname.startsWith('localhost')) {
			return {
				projectId: subdomain,
				isPathBased: false,
			};
		}

		return { projectId: null, isPathBased: false };
	}

	/**
	 * Rewrite request URL to strip path-based project prefix
	 */
	private rewriteRequestUrl(request: Request, projectId: string): Request {
		const url = new URL(request.url);
		const prefix = `/__project/${projectId}`;

		if (url.pathname.startsWith(prefix)) {
			// Strip the prefix and keep the rest
			const newPathname = url.pathname.slice(prefix.length) || '/';
			url.pathname = newPathname;
		}

		return new Request(url.toString(), {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});
	}

	/**
	 * Create a new project
	 */
	private async createProject(request: Request): Promise<Response> {
		const body = await request.json<{ name?: string }>();
		const projectId = crypto.randomUUID();

		const project: ProjectMetadata = {
			id: projectId,
			name: body.name || `Project ${projectId}`,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			hasServerCode: false,
			assetsCount: 0,
		};

		await this.env.PROJECTS_KV_NAMESPACE.put(`project:${projectId}`, JSON.stringify(project));

		return new Response(
			JSON.stringify({
				success: true,
				project,
			}),
			{
				status: 201,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	/**
	 * List all projects
	 */
	private async listProjects(): Promise<Response> {
		const { keys } = await this.env.PROJECTS_KV_NAMESPACE.list({ prefix: 'project:', limit: 100 });

		const projects = await Promise.all(
			keys.map(async (key: { name: string }) => {
				return await this.env.PROJECTS_KV_NAMESPACE.get<ProjectMetadata>(key.name, 'json');
			})
		);

		return new Response(
			JSON.stringify({
				success: true,
				projects: projects.filter((p: ProjectMetadata | null) => p !== null),
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	/**
	 * Get project information
	 */
	private async getProjectInfo(projectId: string): Promise<Response> {
		const project = await this.getProject(projectId);

		if (!project) {
			return new Response('Project not found', { status: 404 });
		}

		return new Response(
			JSON.stringify({
				success: true,
				project,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	/**
	 * Delete a project and its metadata
	 */
	private async deleteProject(projectId: string): Promise<Response> {
		const project = await this.getProject(projectId);

		if (!project) {
			return new Response('Project not found', { status: 404 });
		}

		// Delete assets and manifest via AssetApi RPC
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		const assetDeletion = await assets.deleteProjectAssets(projectId);

		// Delete server code if exists (modules + manifest)
		let deletedServerCodeModules = 0;
		if (project.hasServerCode) {
			const serverCodePrefix = this.getServerCodePrefix(projectId);

			// Delete all server code modules and manifest using pagination
			for await (const key of listAllKeys(this.env.SERVER_CODE_KV_NAMESPACE, { prefix: serverCodePrefix })) {
				await this.env.SERVER_CODE_KV_NAMESPACE.delete(key.name);
				deletedServerCodeModules++;
			}
		}

		// Delete project metadata
		await this.env.PROJECTS_KV_NAMESPACE.delete(`project:${projectId}`);

		return new Response(
			JSON.stringify({
				success: true,
				message: 'Project deleted',
				deletedAssets: assetDeletion.deletedAssets,
				deletedManifest: assetDeletion.deletedManifest,
				deletedServerCode: project.hasServerCode,
				deletedServerCodeModules,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	/**
	 * Deploy a full-stack project (assets + optional server code)
	 */
	private async deployProject(projectId: string, request: Request): Promise<Response> {
		const project = await this.getProject(projectId);

		if (!project) {
			return new Response('Project not found', { status: 404 });
		}

		const payload = await request.json<DeploymentPayload>();

		// Update project name if provided
		if (payload.projectName) {
			project.name = payload.projectName;
		}

		// Deploy assets
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		const manifestEntries: ManifestEntry[] = [];
		const assetContents = new Map<string, { content: ArrayBuffer; contentType?: string }>();

		for (const asset of payload.assets) {
			// Decode base64 content
			const content = Uint8Array.from(atob(asset.content), (c) => c.charCodeAt(0));
			const contentHash = await computeContentHash(content);

			manifestEntries.push({
				pathname: asset.pathname,
				contentHash,
			});

			assetContents.set(contentHash, {
				content: content.buffer,
				contentType: asset.contentType,
			});
		}

		// Upload manifest with project namespace
		const newEntries = await assets.uploadManifest(manifestEntries, projectId);

		// Upload new assets
		for (const entry of newEntries) {
			const assetData = assetContents.get(entry.contentHash);
			if (assetData) {
				await assets.uploadAsset(entry.contentHash, assetData.content, assetData.contentType, projectId);
			}
		}

		// Deploy server code if provided
		let totalServerCodeModules = 0;
		let newServerCodeModules = 0;
		if (payload.serverCode) {
			// Compute content hash for each module and store them separately
			const moduleManifest: Record<string, string> = {};
			const modulesToUpload: { hash: string; content: string }[] = [];

			for (const [modulePath, moduleContent] of Object.entries(payload.serverCode.modules)) {
				const contentHash = await computeContentHash(new TextEncoder().encode(moduleContent));
				moduleManifest[modulePath] = contentHash;
				totalServerCodeModules++;

				// Check if module already exists in KV
				const moduleKey = this.getServerCodeKey(projectId, contentHash);
				const existingModule = await this.env.SERVER_CODE_KV_NAMESPACE.get(moduleKey);

				if (!existingModule) {
					modulesToUpload.push({ hash: contentHash, content: moduleContent });
				}
			}

			newServerCodeModules = modulesToUpload.length;

			// Upload new modules
			await Promise.all(
				modulesToUpload.map(async ({ hash, content }) => {
					const moduleKey = this.getServerCodeKey(projectId, hash);
					await this.env.SERVER_CODE_KV_NAMESPACE.put(moduleKey, content);
				})
			);

			// Store the manifest
			const manifest: ServerCodeManifest = {
				entrypoint: payload.serverCode.entrypoint,
				modules: moduleManifest,
				compatibilityDate: payload.serverCode.compatibilityDate || '2025-11-09',
				env: { ...payload.env },
			};

			const manifestKey = this.getServerCodeKey(projectId, 'MANIFEST');
			await this.env.SERVER_CODE_KV_NAMESPACE.put(manifestKey, JSON.stringify(manifest));
			project.hasServerCode = true;
		}

		// Update project metadata
		project.updatedAt = new Date().toISOString();
		project.assetsCount = manifestEntries.length;

		// Store config if provided
		if (payload.config) {
			project.config = payload.config;
		}

		// Store run_worker_first setting
		if (payload.run_worker_first !== undefined) {
			project.run_worker_first = payload.run_worker_first;
		}

		await this.env.PROJECTS_KV_NAMESPACE.put(`project:${projectId}`, JSON.stringify(project));

		return new Response(
			JSON.stringify({
				success: true,
				message: 'Project deployed successfully',
				project,
				deployedAssets: manifestEntries.length,
				newAssets: newEntries.length,
				skippedAssets: manifestEntries.length - newEntries.length,
				deployedServerCodeModules: totalServerCodeModules,
				newServerCodeModules,
				skippedServerCodeModules: totalServerCodeModules - newServerCodeModules,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	/**
	 * Get project metadata from KV
	 */
	private async getProject(projectId: string): Promise<ProjectMetadata | null> {
		return await this.env.PROJECTS_KV_NAMESPACE.get<ProjectMetadata>(`project:${projectId}`, 'json');
	}

	/**
	 * Get the namespaced key for server code
	 */
	private getServerCodeKey(projectId: string, key: string): string {
		return `${projectId}:servercode:${key}`;
	}

	/**
	 * Get the server code prefix for a project
	 */
	private getServerCodePrefix(projectId: string): string {
		return `${projectId}:servercode:`;
	}

	/**
	 * Run server code for a project using dynamic worker loading
	 */
	private async runServerCode(request: Request, projectId: string, assetConfig?: AssetConfig): Promise<Response> {
		// Load the manifest
		const manifestKey = this.getServerCodeKey(projectId, 'MANIFEST');
		const manifest = await this.env.SERVER_CODE_KV_NAMESPACE.get<ServerCodeManifest>(manifestKey, 'json');

		if (!manifest) {
			return new Response('Server code not found', { status: 404 });
		}

		const { entrypoint, modules: moduleManifest, compatibilityDate, env = {} } = manifest;

		// Load all modules from KV by their content hashes
		const modules: Record<string, string> = {};
		await Promise.all(
			Object.entries(moduleManifest).map(async ([modulePath, contentHash]) => {
				const moduleKey = this.getServerCodeKey(projectId, contentHash);
				const moduleContent = await this.env.SERVER_CODE_KV_NAMESPACE.get(moduleKey, 'text');

				if (!moduleContent) {
					throw new Error(`Module ${modulePath} with hash ${contentHash} not found in KV`);
				}

				modules[modulePath] = moduleContent;
			})
		);

		// Use content hash of the manifest as the worker key for caching
		const codeHash = await computeContentHash(new TextEncoder().encode(JSON.stringify(manifest)));

		const worker = this.env.LOADER.get(codeHash, () => {
			return {
				compatibilityDate: compatibilityDate || '2025-11-09',
				mainModule: entrypoint,
				modules,
				env: {
					...env,
					ASSETS: this.ctx.exports.AssetBinding({ props: { projectId, config: assetConfig } }),
				},
				globalOutbound: null, // disable internet access
			};
		});

		const defaultEntrypoint = worker.getEntrypoint(undefined, {});

		return await defaultEntrypoint.fetch(request);
	}
}

async function computeContentHash(content: ArrayBuffer | ArrayBufferView): Promise<string> {
	const contentHashBuffer = await crypto.subtle.digest('SHA-256', content);
	const contentHash = Array.from(new Uint8Array(contentHashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return contentHash;
}

async function* listAllKeys<TMetadata, TKey extends string = string>(
	namespace: KVNamespace<TKey>,
	options: KVNamespaceListOptions
): AsyncGenerator<KVNamespaceListKey<TMetadata, TKey>, void, undefined> {
	let complete = false;
	let cursor: string | undefined;

	while (!complete) {
		// eslint-disable-next-line no-await-in-loop
		const result = await namespace.list<TMetadata>({
			...options,
			cursor,
		});

		yield* result.keys;

		if (result.list_complete) {
			complete = true;
		} else {
			({ cursor } = result);
		}
	}
}
