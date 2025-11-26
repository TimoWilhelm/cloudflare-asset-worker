import { WorkerEntrypoint } from 'cloudflare:workers';
import type AssetApi from '../../asset-service/src/worker';
import type { AssetConfig } from '../../asset-service/src/configuration';
import { Hono } from 'hono';
import { extractProjectId, rewriteRequestUrl, shouldRunWorkerFirst } from './routing';
import { getProject, createProject, listProjects, getProjectInfo, deleteProject } from './project-manager';
import { createAssetUploadSession, uploadAssets } from './asset-manager';
import { deployProject } from './deployment-manager';
import { runServerCode } from './server-code-runner';
import { Analytics } from './analytics';

export class AssetBinding extends WorkerEntrypoint<Env, { projectId: string; config?: AssetConfig }> {
	override async fetch(request: Request): Promise<Response> {
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		return await assets.serveAsset(request, this.ctx.props.projectId, this.ctx.props.config);
	}
}

export default class AssetManager extends WorkerEntrypoint<Env> {
	override async fetch(request: Request): Promise<Response> {
		const startTime = performance.now();
		const analytics = new Analytics(this.env.ANALYTICS);
		const url = new URL(request.url);

		const userAgent = request.headers.get('user-agent') ?? 'UA UNKNOWN';
		const coloRegion = request.cf?.colo as string;

		analytics.setData({
			hostname: url.hostname,
			userAgent,
			coloRegion,
			pathname: url.pathname,
			method: request.method,
		});

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
						500,
					);
				}

				if (!authHeader || authHeader !== apiToken) {
					return c.json(
						{
							success: false,
							error: 'Unauthorized: Invalid or missing Authorization header',
						},
						401,
					);
				}

				await next();
			});

			app.post('/__api/projects', async (c) => {
				return createProject(c.req.raw, this.env.KV_PROJECTS);
			});

			app.get('/__api/projects', async (c) => {
				return listProjects(this.env.KV_PROJECTS);
			});

			app.get('/__api/projects/:projectId', async (c) => {
				const projectId = c.req.param('projectId');
				return getProjectInfo(projectId, this.env.KV_PROJECTS);
			});

			app.delete('/__api/projects/:projectId', async (c) => {
				const projectId = c.req.param('projectId');
				const assets = this.env.ASSET_WORKER as Service<AssetApi>;
				return deleteProject(projectId, this.env.KV_PROJECTS, this.env.KV_SERVER_CODE, assets);
			});

			app.post('/__api/projects/:projectId/assets-upload-session', async (c) => {
				const projectId = c.req.param('projectId');
				const assets = this.env.ASSET_WORKER as Service<AssetApi>;
				return createAssetUploadSession(projectId, c.req.raw, this.env.KV_PROJECTS, assets, this.env.JWT_SECRET);
			});

			app.post('/__api/projects/:projectId/assets/upload', async (c) => {
				const projectId = c.req.param('projectId');
				const assets = this.env.ASSET_WORKER as Service<AssetApi>;
				return uploadAssets(projectId, c.req.raw, this.env.KV_PROJECTS, assets, this.env.JWT_SECRET);
			});

			app.post('/__api/projects/:projectId/deploy', async (c) => {
				const projectId = c.req.param('projectId');
				const assets = this.env.ASSET_WORKER as Service<AssetApi>;
				return deployProject(projectId, c.req.raw, this.env.KV_PROJECTS, this.env.KV_SERVER_CODE, assets, this.env.JWT_SECRET);
			});

			app.onError((err, c) => {
				return c.json(
					{
						success: false,
						error: err instanceof Error ? err.message : 'Unknown error',
					},
					500,
				);
			});

			const response = await app.fetch(request, this.env);
			analytics.setData({
				requestType: 'api',
				status: response.status,
				requestTime: performance.now() - startTime,
			});
			analytics.write();
			return response;
		}

		// Project serving - extract project ID from subdomain or path
		const { projectId, isPathBased } = extractProjectId(url);

		analytics.setData({
			projectId: projectId ?? 'none',
			routingType: isPathBased ? 'path' : 'subdomain',
		});

		if (!projectId) {
			const response = new Response('Project not found. Access via subdomain (project-id.domain.com) or path (/__project/project-id/)', {
				status: 404,
			});
			analytics.setData({
				requestType: 'project_not_found',
				status: 404,
				requestTime: performance.now() - startTime,
			});
			analytics.write();
			return response;
		}

		// Verify project exists
		const project = await getProject(projectId, this.env.KV_PROJECTS);
		if (!project) {
			const response = new Response('Project not found', { status: 404 });
			analytics.setData({
				requestType: 'project_not_found',
				status: 404,
				requestTime: performance.now() - startTime,
			});
			analytics.write();
			return response;
		}

		// Rewrite request URL if using path-based routing
		let rewrittenRequest = request;
		if (isPathBased) {
			rewrittenRequest = rewriteRequestUrl(request, projectId);
		}

		// Helper to run server code with common parameters
		const executeServerCode = async () => {
			try {
				analytics.setData({ requestType: 'ssr' });
				const response = await runServerCode(rewrittenRequest, projectId, this.env.KV_SERVER_CODE, this.env.LOADER, {
					ASSETS: this.ctx.exports.AssetBinding({ props: { projectId, config: project.config } }),
				});
				analytics.setData({
					status: response.status,
					requestTime: performance.now() - startTime,
				});
				analytics.write();
				return response;
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error';
				const response = new Response(`SSR Error: ${errorMessage}`, { status: 500 });
				analytics.setData({
					error: errorMessage,
					status: 500,
					requestTime: performance.now() - startTime,
				});
				analytics.write();
				return response;
			}
		};

		// Decide whether to check assets first or run worker first based on config
		const rewrittenUrl = new URL(rewrittenRequest.url);
		const runWorkerFirst = shouldRunWorkerFirst(project.run_worker_first, rewrittenUrl.pathname);

		if (runWorkerFirst && project.hasServerCode) {
			// Run server code first, let it handle everything including static files
			return executeServerCode();
		}

		// Try to serve static assets first (default behavior)
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;

		try {
			const canServeAsset = await assets.canFetch(rewrittenRequest, projectId, project.config);

			if (canServeAsset) {
				analytics.setData({ requestType: 'asset' });
				const response = await assets.serveAsset(rewrittenRequest, projectId, project.config);
				analytics.setData({
					status: response.status,
					requestTime: performance.now() - startTime,
				});
				analytics.write();
				return response;
			}

			// If no asset found and project has server code, run dynamic worker
			if (project.hasServerCode) {
				return executeServerCode();
			}

			const response = new Response('Not found', { status: 404 });
			analytics.setData({
				requestType: 'not_found',
				status: 404,
				requestTime: performance.now() - startTime,
			});
			analytics.write();
			return response;
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Unknown error';
			const response = new Response(`Error: ${errorMessage}`, { status: 500 });
			analytics.setData({
				requestType: 'error',
				error: errorMessage,
				status: 500,
				requestTime: performance.now() - startTime,
			});
			analytics.write();
			return response;
		}
	}
}
