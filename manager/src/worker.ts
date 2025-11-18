import { WorkerEntrypoint } from 'cloudflare:workers';
import type AssetApi from '../../api/src/worker';
import type { ManifestEntry } from '../../api/src/worker';
import type { AssetConfig } from '../../api/src/configuration';
import { minimatch } from 'minimatch';
import { Hono } from 'hono';
import * as base64 from '@stablelib/base64';

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

type ModuleType = 'js' | 'cjs' | 'py' | 'text' | 'data' | 'json';

interface ServerCodeManifest {
	entrypoint: string;
	// Map of module path to { hash, type }
	modules: Record<string, { hash: string; type: ModuleType }>;
	compatibilityDate?: string;
	env?: Record<string, string>;
}

interface UploadSession {
	sessionId: string;
	projectId: string;
	manifest: Record<string, { hash: string; size: number }>;
	buckets: string[][];
	uploadedHashes: Set<string>;
	createdAt: number;
	completionToken?: string;
}

interface AssetManifestRequest {
	manifest: Record<string, { hash: string; size: number }>;
}

interface DeploymentPayload {
	projectName?: string;
	completionJwt?: string;
	serverCode?: {
		entrypoint: string;
		// Modules are base64-encoded with optional type specification
		// Can be: string (base64) or { content: string, type: ModuleType }
		modules: Record<string, string | { content: string; type: ModuleType }>;
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
			// Exclude JWT-authenticated endpoints (assets/upload uses Bearer tokens)
			app.use('/__api/*', async (c, next) => {
				const path = c.req.path;

				// Skip API_TOKEN check for JWT-authenticated endpoints
				if (path.endsWith('/assets/upload')) {
					await next();
					return;
				}

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

			app.post('/__api/projects/:projectId/assets-upload-session', async (c) => {
				const projectId = c.req.param('projectId');
				return this.createAssetUploadSession(projectId, c.req.raw);
			});

			app.post('/__api/projects/:projectId/assets/upload', async (c) => {
				const projectId = c.req.param('projectId');
				return this.uploadAssets(projectId, c.req.raw);
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
	 * Create an asset upload session
	 * Phase 1: Register manifest and get upload instructions
	 */
	private async createAssetUploadSession(projectId: string, request: Request): Promise<Response> {
		const project = await this.getProject(projectId);

		if (!project) {
			return new Response('Project not found', { status: 404 });
		}

		const payload = await request.json<AssetManifestRequest>();
		const { manifest } = payload;

		// Validate manifest
		if (!manifest || typeof manifest !== 'object') {
			return new Response('Invalid manifest', { status: 400 });
		}

		// Validate manifest size
		const MAX_MANIFEST_ENTRIES = 10000;
		const manifestSize = Object.keys(manifest).length;
		if (manifestSize === 0) {
			return new Response('Empty manifest', { status: 400 });
		}
		if (manifestSize > MAX_MANIFEST_ENTRIES) {
			return new Response(
				`Manifest too large: ${manifestSize} files exceeds ${MAX_MANIFEST_ENTRIES}`,
				{ status: 413 }
			);
		}

		// Validate each manifest entry
		let totalSize = 0;
		for (const [pathname, data] of Object.entries(manifest)) {
			// Validate pathname
			if (!pathname || !pathname.startsWith('/')) {
				return new Response(`Invalid pathname "${pathname}": must start with /`, { status: 400 });
			}

			// Validate hash format (must be 64 hex characters for SHA-256)
			if (!data.hash || !/^[0-9a-f]{64}$/i.test(data.hash)) {
				return new Response(
					`Invalid hash for "${pathname}": must be 64 hexadecimal characters`,
					{ status: 400 }
				);
			}

			// Validate size (must be non-negative integer)
			if (typeof data.size !== 'number' || data.size < 0 || !Number.isInteger(data.size)) {
				return new Response(`Invalid size for "${pathname}": must be non-negative integer`, { status: 400 });
			}

			// Validate reasonable size limit (e.g., 100MB per file)
			const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
			if (data.size > MAX_FILE_SIZE) {
				return new Response(
					`File too large "${pathname}": ${data.size} bytes exceeds ${MAX_FILE_SIZE} bytes`,
					{ status: 413 }
				);
			}

			totalSize += data.size;
		}

		// Validate total manifest size (e.g., 1GB total)
		const MAX_TOTAL_SIZE = 1024 * 1024 * 1024; // 1GB
		if (totalSize > MAX_TOTAL_SIZE) {
			return new Response(
				`Total manifest size too large: ${totalSize} bytes exceeds ${MAX_TOTAL_SIZE} bytes`,
				{ status: 413 }
			);
		}

		// Check which hashes already exist in KV via AssetApi's efficient checkAssetsExist method
		// This only uploads assets that are missing or have changed content hashes
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		const allHashes = Object.values(manifest).map((entry) => entry.hash);
		const uniqueHashes = [...new Set(allHashes)];

		const existenceChecks = await assets.checkAssetsExist(uniqueHashes, projectId);

		// Get hashes that need to be uploaded (assets that don't exist or have changed)
		const hashesToUpload = existenceChecks.filter(({ exists }) => !exists).map(({ hash }) => hash);
		const existingCount = existenceChecks.filter(({ exists }) => exists).length;

		// Log for debugging: helps verify optimization is working
		console.log(`Asset check: ${existingCount}/${uniqueHashes.length} assets already exist`);

		// Create buckets (batch uploads for optimal performance)
		const buckets = this.createBuckets(hashesToUpload, 10); // Max 10 files per bucket

		// Create session
		const sessionId = crypto.randomUUID();
		const session: UploadSession = {
			sessionId,
			projectId,
			manifest,
			buckets,
			uploadedHashes: new Set(),
			createdAt: Date.now(),
		};

		// Generate JWT for upload phase
		const uploadJwt = await this.generateJWT({ sessionId, projectId, phase: 'upload' });

		// Optimization: If all assets already exist with matching contentHash, skip upload phase entirely
		// and return completion token immediately for deployment
		if (buckets.length === 0) {
			const completionJwt = await this.generateJWT({ sessionId, projectId, phase: 'complete', manifest });
			session.completionToken = completionJwt;

			// Still need to store session for deployment phase to verify the completion token
			const sessionKey = `session:${sessionId}`;
			await this.env.PROJECTS_KV_NAMESPACE.put(
				sessionKey,
				JSON.stringify({ ...session, uploadedHashes: Array.from(session.uploadedHashes) }),
				{
					expirationTtl: 3600, // 1 hour
				}
			);

			return new Response(
				JSON.stringify({
					result: {
						jwt: completionJwt,
						buckets: [],
					},
					success: true,
					errors: null,
					messages: null,
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// Store session in KV with 1 hour expiration
		const sessionKey = `session:${sessionId}`;
		await this.env.PROJECTS_KV_NAMESPACE.put(
			sessionKey,
			JSON.stringify({ ...session, uploadedHashes: Array.from(session.uploadedHashes) }),
			{
				expirationTtl: 3600, // 1 hour
			}
		);

		return new Response(
			JSON.stringify({
				result: {
					jwt: uploadJwt,
					buckets,
				},
					success: true,
					errors: null,
					messages: null,
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}
			);
	}

	/**
	 * Upload assets in buckets
	 * Phase 2: Upload files with JWT authentication
	 */
	private async uploadAssets(projectId: string, request: Request): Promise<Response> {
		// Extract JWT from Authorization header
		const authHeader = request.headers.get('Authorization');
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return new Response('Missing or invalid Authorization header', { status: 401 });
		}

		const jwt = authHeader.substring(7);
		const jwtPayload = await this.verifyJWT(jwt);

		if (!jwtPayload || jwtPayload.phase !== 'upload' || jwtPayload.projectId !== projectId) {
			return new Response('Invalid or expired JWT', { status: 401 });
		}

		// Load session
		const sessionKey = `session:${jwtPayload.sessionId}`;
		const sessionData = await this.env.PROJECTS_KV_NAMESPACE.get(sessionKey, 'text');
		if (!sessionData) {
			return new Response('Session expired or not found', { status: 404 });
		}

		const session: UploadSession = JSON.parse(sessionData);
		session.uploadedHashes = new Set(session.uploadedHashes); // Restore Set from JSON

		// Parse body - expecting JSON with base64 encoded files
		const payload = await request.json<Record<string, string>>();

		// Validate payload is not empty
		if (!payload || Object.keys(payload).length === 0) {
			return new Response('Empty upload payload', { status: 400 });
		}

		// Validate number of files (shouldn't exceed bucket size)
		const MAX_FILES_PER_REQUEST = 50; // Conservative limit
		if (Object.keys(payload).length > MAX_FILES_PER_REQUEST) {
			return new Response(
				`Too many files in request: ${Object.keys(payload).length} exceeds ${MAX_FILES_PER_REQUEST}`,
				{ status: 413 }
			);
		}

		const assets = this.env.ASSET_WORKER as Service<AssetApi>;

		// Upload each asset
		for (const [hash, base64Content] of Object.entries(payload)) {
			// Verify hash is in the manifest
			const isValidHash = Object.values(session.manifest).some((entry) => entry.hash === hash);
			if (!isValidHash) {
				return new Response(`Hash ${hash} not found in manifest`, { status: 400 });
			}

			// Prevent duplicate uploads in the same session
			if (session.uploadedHashes.has(hash)) {
				return new Response(`Hash ${hash} already uploaded in this session`, { status: 400 });
			}

			// Decode base64
			const content = base64.decode(base64Content);

			// Verify the uploaded content matches the claimed hash
			const actualHash = await computeContentHash(content);
			if (actualHash !== hash) {
				return new Response(
					`Content hash mismatch: expected ${hash}, got ${actualHash}`,
					{ status: 400 }
				);
			}

			// Verify size matches manifest (optional but recommended)
			const manifestEntry = Object.entries(session.manifest).find(([_, data]) => data.hash === hash);
			if (manifestEntry) {
				const [pathname, data] = manifestEntry;
				if (data.size && content.length !== data.size) {
					return new Response(
						`Size mismatch for ${pathname}: expected ${data.size}, got ${content.length}`,
						{ status: 400 }
					);
				}
			}

			// Find content type for this hash
			let contentType: string | undefined;
			if (manifestEntry) {
				const pathname = manifestEntry[0];
				contentType = this.guessContentType(pathname);
			}

			// Upload to KV via AssetApi
			await assets.uploadAsset(hash, content.buffer as ArrayBuffer, contentType, projectId);
			session.uploadedHashes.add(hash);
		}

		// Check if all buckets are uploaded
		const allHashesInBuckets = session.buckets.flat();
		const allUploaded = allHashesInBuckets.every((hash) => session.uploadedHashes.has(hash));

		// Update session
		await this.env.PROJECTS_KV_NAMESPACE.put(
			sessionKey,
			JSON.stringify({ ...session, uploadedHashes: Array.from(session.uploadedHashes) }),
			{ expirationTtl: 3600 }
		);

		// If all uploads complete, return completion JWT
		if (allUploaded) {
			const completionJwt = await this.generateJWT({
				sessionId: session.sessionId,
				projectId,
				phase: 'complete',
				manifest: session.manifest,
			});

			// Update session with completion token
			session.completionToken = completionJwt;
			await this.env.PROJECTS_KV_NAMESPACE.put(
				sessionKey,
				JSON.stringify({ ...session, uploadedHashes: Array.from(session.uploadedHashes) }),
				{ expirationTtl: 3600 }
			);

			return new Response(
				JSON.stringify({
					result: {
						jwt: completionJwt,
					},
					success: true,
					errors: null,
					messages: null,
				}),
				{
					status: 201,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		// More uploads pending
		return new Response(
			JSON.stringify({
				result: {
					jwt: null,
				},
					success: true,
					errors: null,
					messages: null,
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}
			);
	}

	/**
	 * Deploy a full-stack project (assets + optional server code)
	 * Phase 3: Finalize deployment with completion JWT
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

		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		let manifestEntries: ManifestEntry[] = [];
		let newEntries: ManifestEntry[] = [];

		// Handle assets deployment with completion JWT
		if (payload.completionJwt) {
			// Verify completion JWT
			const jwtPayload = await this.verifyJWT(payload.completionJwt);
			if (!jwtPayload || jwtPayload.phase !== 'complete' || jwtPayload.projectId !== projectId) {
				return new Response('Invalid or expired completion JWT', { status: 401 });
			}

			// Check if session still exists and has the completion token
			// This prevents JWT reuse after the session expires
			const sessionKey = `session:${jwtPayload.sessionId}`;
			const sessionData = await this.env.PROJECTS_KV_NAMESPACE.get(sessionKey, 'text');
			if (!sessionData) {
				// Session expired - JWT may have been used already or is too old
				return new Response('Upload session expired', { status: 401 });
			}

			const session = JSON.parse(sessionData);
			if (session.completionToken !== payload.completionJwt) {
				return new Response('Invalid completion JWT', { status: 401 });
			}

			// Delete session after successful verification to prevent reuse
			await this.env.PROJECTS_KV_NAMESPACE.delete(sessionKey);

			// Load manifest from JWT
			const manifest = jwtPayload.manifest as Record<string, { hash: string; size: number }>;

			// Convert manifest to ManifestEntry format
			for (const [pathname, data] of Object.entries(manifest)) {
				manifestEntries.push({
					pathname,
					contentHash: data.hash,
				});
			}

			// Upload manifest (all assets should already be in KV)
			newEntries = await assets.uploadManifest(manifestEntries, projectId);
		}

		// Deploy server code if provided
		let totalServerCodeModules = 0;
		let newServerCodeModules = 0;
		if (payload.serverCode) {
			// Compute content hash for each module and store them separately
			const moduleManifest: Record<string, { hash: string; type: ModuleType }> = {};
			const modulesToUpload: { hash: string; content: string; type: ModuleType }[] = [];

			for (const [modulePath, moduleData] of Object.entries(payload.serverCode.modules)) {
				// Handle both formats: string (base64) or { content: base64, type: ModuleType }
				const base64Content = typeof moduleData === 'string' ? moduleData : moduleData.content;
				let moduleType: ModuleType;

				if (typeof moduleData === 'object' && moduleData.type) {
					// Explicit type provided
					moduleType = moduleData.type;
				} else {
					// Infer type from file extension
					moduleType = this.inferModuleType(modulePath);
				}

				// Compute hash from base64 content (content-addressed storage)
				const contentHash = await computeContentHash(base64.decode(base64Content));
				moduleManifest[modulePath] = { hash: contentHash, type: moduleType };
				totalServerCodeModules++;

				// Check if module already exists in KV
				const moduleKey = this.getServerCodeKey(projectId, contentHash);
				const existingModule = await this.env.SERVER_CODE_KV_NAMESPACE.get(moduleKey);

				if (!existingModule) {
					// Store base64-encoded content in KV
					modulesToUpload.push({ hash: contentHash, content: base64Content, type: moduleType });
				}
			}

			newServerCodeModules = modulesToUpload.length;

			// Upload new modules (stored as base64)
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
	 * Get the namespaced key for assets
	 */
	private getNamespacedKey(projectId: string, key: string): string {
		return `${projectId}:${key}`;
	}

	/**
	 * Get the namespaced key for server code
	 */
	private getServerCodeKey(projectId: string, key: string): string {
		return `${projectId}:servercode:${key}`;
	}

	/**
	 * Create buckets for optimal batch uploading
	 */
	private createBuckets(hashes: string[], maxPerBucket: number = 10): string[][] {
		const buckets: string[][] = [];
		for (let i = 0; i < hashes.length; i += maxPerBucket) {
			buckets.push(hashes.slice(i, i + maxPerBucket));
		}
		return buckets;
	}

	/**
	 * Generate a JWT token for upload sessions
	 */
	private async generateJWT(payload: any): Promise<string> {
		// Simple JWT-like token using base64 encoding
		// In production, use proper JWT signing with crypto.subtle
		const header = { alg: 'HS256', typ: 'JWT' };
		const data = {
			...payload,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
		};

		const encodedHeader = base64.encode(new TextEncoder().encode(JSON.stringify(header)));
		const encodedPayload = base64.encode(new TextEncoder().encode(JSON.stringify(data)));

		// Create signature using HMAC-SHA256
		const secret = this.env.JWT_SECRET;
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			'raw',
			encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);

		const signature = await crypto.subtle.sign(
			'HMAC',
			key,
			encoder.encode(`${encodedHeader}.${encodedPayload}`)
		);

		const encodedSignature = base64.encode(new Uint8Array(signature));
		return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
	}

	/**
	 * Verify and decode a JWT token
	 */
	private async verifyJWT(token: string): Promise<any | null> {
		try {
			const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
			if (!encodedHeader || !encodedPayload || !encodedSignature) {
				return null;
			}

			// Verify signature
			const secret = this.env.JWT_SECRET;
			const encoder = new TextEncoder();
			const key = await crypto.subtle.importKey(
				'raw',
				encoder.encode(secret),
				{ name: 'HMAC', hash: 'SHA-256' },
				false,
				['verify']
			);

			const signatureBytes = base64.decode(encodedSignature);
			const isValid = await crypto.subtle.verify(
				'HMAC',
				key,
				signatureBytes,
				encoder.encode(`${encodedHeader}.${encodedPayload}`)
			);

			if (!isValid) {
				return null;
			}

			// Decode payload
			const payload = JSON.parse(new TextDecoder().decode(base64.decode(encodedPayload)));

			// Check expiration
			if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
				return null;
			}

			return payload;
		} catch {
			return null;
		}
	}

	/**
	 * Guess content type from pathname
	 */
	private guessContentType(pathname: string): string | undefined {
		const ext = pathname.split('.').pop()?.toLowerCase();
		const contentTypes: Record<string, string> = {
			html: 'text/html',
			css: 'text/css',
			js: 'application/javascript',
			json: 'application/json',
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			svg: 'image/svg+xml',
			webp: 'image/webp',
			xml: 'application/xml',
			pdf: 'application/pdf',
			zip: 'application/zip',
			txt: 'text/plain',
			md: 'text/markdown',
			woff: 'font/woff',
			woff2: 'font/woff2',
			ttf: 'font/ttf',
			eot: 'application/vnd.ms-fontobject',
			otf: 'font/otf',
		};
		return ext ? contentTypes[ext] : undefined;
	}

	/**
	 * Infer module type from file extension
	 */
	private inferModuleType(modulePath: string): ModuleType {
		const ext = modulePath.split('.').pop()?.toLowerCase();
		switch (ext) {
			case 'js':
			case 'mjs':
				return 'js';
			case 'cjs':
				return 'cjs';
			case 'py':
				return 'py';
			case 'txt':
				return 'text';
			case 'json':
				return 'json';
			default:
				return 'js'; // Default to ES modules
		}
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

		// Load all modules from KV by their content hashes and decode based on type
		const modules: Record<string, any> = {};
		await Promise.all(
			Object.entries(moduleManifest).map(async ([modulePath, { hash: contentHash, type }]) => {
				const moduleKey = this.getServerCodeKey(projectId, contentHash);
				const base64Content = await this.env.SERVER_CODE_KV_NAMESPACE.get(moduleKey, 'text');

				if (!base64Content) {
					throw new Error(`Module ${modulePath} with hash ${contentHash} not found in KV`);
				}

				// Decode base64 content and format according to module type
				const decodedBytes = base64.decode(base64Content);

				switch (type) {
					case 'js':
						modules[modulePath] = { js: new TextDecoder().decode(decodedBytes) };
						break;
					case 'cjs':
						modules[modulePath] = { cjs: new TextDecoder().decode(decodedBytes) };
						break;
					case 'py':
						modules[modulePath] = { py: new TextDecoder().decode(decodedBytes) };
						break;
					case 'text':
						modules[modulePath] = { text: new TextDecoder().decode(decodedBytes) };
						break;
					case 'data':
						modules[modulePath] = { data: decodedBytes.buffer };
						break;
					case 'json':
						const jsonString = new TextDecoder().decode(decodedBytes);
						modules[modulePath] = { json: JSON.parse(jsonString) };
						break;
					default:
						// Fallback to plain string for unknown types
						modules[modulePath] = new TextDecoder().decode(decodedBytes);
				}
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
