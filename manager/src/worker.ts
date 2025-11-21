import { WorkerEntrypoint } from 'cloudflare:workers';
import type AssetApi from '../../api/src/worker';
import type { AssetConfig } from '../../api/src/configuration';
import { Hono } from 'hono';
import { extractProjectId, rewriteRequestUrl, shouldRunWorkerFirst } from './routing';
import { getProject, createProject, listProjects, getProjectInfo, deleteProject } from './project-manager';
import { createAssetUploadSession, uploadAssets } from './asset-manager';
import { deployProject } from './deployment-manager';
import { runServerCode } from './server-code-runner';

export class AssetBinding extends WorkerEntrypoint<Env, { projectId: string; config?: AssetConfig }> {
	override async fetch(request: Request): Promise<Response> {
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		return await assets.serveAsset(request, this.ctx.props.projectId, this.ctx.props.config);
	}
}

export default class AssetManager extends WorkerEntrypoint<Env> {
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
				return createProject(c.req.raw, this.env.PROJECTS_KV_NAMESPACE);
			});

			app.get('/__api/projects', async (c) => {
				return listProjects(this.env.PROJECTS_KV_NAMESPACE);
			});

			app.get('/__api/projects/:projectId', async (c) => {
				const projectId = c.req.param('projectId');
				return getProjectInfo(projectId, this.env.PROJECTS_KV_NAMESPACE);
			});

			app.delete('/__api/projects/:projectId', async (c) => {
				const projectId = c.req.param('projectId');
				const assets = this.env.ASSET_WORKER as Service<AssetApi>;
				return deleteProject(projectId, this.env.PROJECTS_KV_NAMESPACE, this.env.SERVER_CODE_KV_NAMESPACE, assets);
			});

			app.post('/__api/projects/:projectId/assets-upload-session', async (c) => {
				const projectId = c.req.param('projectId');
				const assets = this.env.ASSET_WORKER as Service<AssetApi>;
				return createAssetUploadSession(projectId, c.req.raw, this.env.PROJECTS_KV_NAMESPACE, assets, this.env.JWT_SECRET);
			});

			app.post('/__api/projects/:projectId/assets/upload', async (c) => {
				const projectId = c.req.param('projectId');
				const assets = this.env.ASSET_WORKER as Service<AssetApi>;
				return uploadAssets(projectId, c.req.raw, this.env.PROJECTS_KV_NAMESPACE, assets, this.env.JWT_SECRET);
			});

			app.post('/__api/projects/:projectId/deploy', async (c) => {
				const projectId = c.req.param('projectId');
				const assets = this.env.ASSET_WORKER as Service<AssetApi>;
				return deployProject(
					projectId,
					c.req.raw,
					this.env.PROJECTS_KV_NAMESPACE,
					this.env.SERVER_CODE_KV_NAMESPACE,
					assets,
					this.env.JWT_SECRET
				);
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
		const { projectId, isPathBased } = extractProjectId(url);

		if (!projectId) {
			return new Response('Project not found. Access via subdomain (project-id.domain.com) or path (/__project/project-id/)', {
				status: 404,
			});
		}

		// Verify project exists
		const project = await getProject(projectId, this.env.PROJECTS_KV_NAMESPACE);
		if (!project) {
			return new Response('Project not found', { status: 404 });
		}

		// Rewrite request URL if using path-based routing
		let rewrittenRequest = request;
		if (isPathBased) {
			rewrittenRequest = rewriteRequestUrl(request, projectId);
		}

		// Helper to run server code with common parameters
		const executeServerCode = () =>
			runServerCode(
				rewrittenRequest,
				projectId,
				this.env.SERVER_CODE_KV_NAMESPACE,
				this.env.LOADER,
				{
					ASSETS: this.ctx.exports.AssetBinding({ props: { projectId, config: project.config } }),
				},
				project.config
			);

		// Decide whether to check assets first or run worker first based on config
		const rewrittenUrl = new URL(rewrittenRequest.url);
		const runWorkerFirst = shouldRunWorkerFirst(project.run_worker_first, rewrittenUrl.pathname);

		if (runWorkerFirst && project.hasServerCode) {
			// Run server code first, let it handle everything including static files
			return executeServerCode();
		}

		// Try to serve static assets first (default behavior)
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;

		const canServeAsset = await assets.canFetch(rewrittenRequest, projectId, project.config);

		if (canServeAsset) {
			return await assets.serveAsset(rewrittenRequest, projectId, project.config);
		}

		// If no asset found and project has server code, run dynamic worker
		if (project.hasServerCode) {
			return executeServerCode();
		}

		return new Response('Not found', { status: 404 });
	}
}
