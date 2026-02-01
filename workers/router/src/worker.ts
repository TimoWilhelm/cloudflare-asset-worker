import { WorkerEntrypoint } from 'cloudflare:workers';
import type AssetApi from '../../asset-service/src/worker';
import type { AssetConfigInput } from '../../asset-service/src/configuration';
import { Hono } from 'hono';
import { extractProjectId, rewriteRequestUrl, shouldRunWorkerFirst } from './routing';
import { getProject, createProject, listProjects, getProjectInfo, deleteProject } from './project-manager';
import { createAssetUploadSession, uploadAssets } from './asset-manager';
import { deployProject } from './deployment-manager';
import { runServerCode } from './server-code-runner';
import { Analytics } from './analytics';
import { rewriteHtmlPaths } from './html-rewriter';

export class AssetBinding extends WorkerEntrypoint<Env, { projectId: string; config?: AssetConfigInput }> {
	override async fetch(request: Request): Promise<Response> {
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;
		return await assets.serveAsset(request, this.ctx.props.projectId, this.ctx.props.config);
	}
}

export default class AssetManager extends WorkerEntrypoint<Env> {
	override async fetch(request: Request): Promise<Response> {
		const startTime = performance.now();
		const analytics = new Analytics();
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

				const ip = c.req.header('CF-Connecting-IP');
				if (ip) {
					const result = await c.env.RATE_LIMIT_API.limit({ key: ip });
					if (!result.success) {
						return c.json(
							{
								success: false,
								error: 'Rate limit exceeded',
							},
							429,
						);
					}
				}

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
				const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
				const cursor = c.req.query('cursor') || undefined;
				return listProjects(this.env.KV_PROJECTS, { limit, cursor });
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

		// Serve Admin UI at /admin paths - check BEFORE project extraction
		if (url.pathname.startsWith('/admin')) {
			const getCookie = (name: string): string | undefined => {
				const cookieString = request.headers.get('Cookie');
				if (!cookieString) return undefined;
				const cookies = cookieString.split(';');
				for (const cookie of cookies) {
					const [key, value] = cookie.split('=').map((c) => c.trim());
					if (key === name) return value;
				}
				return undefined;
			};

			// Allow access to login page without auth
			if (url.pathname === '/admin/login.html') {
				// @ts-ignore - ASSETS binding added in wrangler.jsonc
				return this.env.ASSETS.fetch(request);
			}

			const token = getCookie('admin_token');
			if (token && token === this.env.API_TOKEN) {
				let assetRequest = request;
				// Default to index.html if asking for /admin or /admin/
				if (url.pathname === '/admin' || url.pathname === '/admin/') {
					const newUrl = new URL(request.url);
					newUrl.pathname = '/admin/index.html';
					assetRequest = new Request(newUrl, request);
				}
				// @ts-ignore - ASSETS binding added in wrangler.jsonc
				return this.env.ASSETS.fetch(assetRequest);
			}

			// Redirect to login if unauthorized
			return Response.redirect(new URL('/admin/login.html', request.url).toString(), 302);
		}

		// Project serving - extract project ID from subdomain or path
		const { projectId, isPathBased } = extractProjectId(url);

		analytics.setData({
			projectId: projectId ?? 'none',
			routingType: isPathBased ? 'path' : 'subdomain',
		});

		if (!projectId) {
			// No project and not /admin - return 404
			return new Response('Not found', { status: 404 });
		}

		const result = await this.env.RATE_LIMIT_PROJECT.limit({ key: projectId });
		if (!result.success) {
			return new Response('Rate limit exceeded', { status: 429 });
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

		// Helper to apply path rewriting for path-based routing
		const maybeRewritePaths = (response: Response): Response => {
			if (isPathBased) {
				return rewriteHtmlPaths(response, projectId);
			}
			return response;
		};

		// Helper to run server code with common parameters
		const executeServerCode = async () => {
			try {
				analytics.setData({ requestType: 'ssr' });
				let response = await runServerCode(projectId, rewrittenRequest, {
					ASSETS: this.ctx.exports.AssetBinding({ props: { projectId, config: project.config } }),
				});
				// Rewrite HTML paths for path-based routing
				response = maybeRewritePaths(response);
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
			const response = await executeServerCode();
			// Add header to indicate asset lookup was skipped due to run_worker_first
			const newResponse = new Response(response.body, response);
			newResponse.headers.set('X-Asset-Lookup', 'SKIP');
			return newResponse;
		}

		// Try to serve static assets first (default behavior)
		const assets = this.env.ASSET_WORKER as Service<AssetApi>;

		try {
			// Clone the request because canFetch (RPC) might consume/read the body,
			// rendering rewrittenRequest unusable for executeServerCode later.
			const canServeAsset = await assets.canFetch(rewrittenRequest.clone(), projectId, project.config);

			if (canServeAsset) {
				analytics.setData({ requestType: 'asset' });
				let response = await assets.serveAsset(rewrittenRequest, projectId, project.config);

				// Rewrite JS assets to fix internal absolute paths (e.g. imports of CSS or other chunks)
				const contentType = response.headers.get('content-type');
				if (isPathBased && contentType && (contentType.includes('text/javascript') || contentType.includes('application/javascript'))) {
					const { rewriteJsResponse } = await import('./html-rewriter');
					response = await rewriteJsResponse(response, projectId);
				}

				// Rewrite HTML paths for path-based routing (for HTML assets like index.html)
				response = maybeRewritePaths(response);

				// Add header to indicate asset was found
				const finalResponse = new Response(response.body, response);
				finalResponse.headers.set('X-Asset-Lookup', 'HIT');

				analytics.setData({
					status: finalResponse.status,
					requestTime: performance.now() - startTime,
				});
				analytics.write();
				return finalResponse;
			}

			// If no asset found and project has server code, run dynamic worker
			if (project.hasServerCode) {
				const response = await executeServerCode();
				// Add header to indicate asset lookup was attempted but missed
				const newResponse = new Response(response.body, response);
				newResponse.headers.set('X-Asset-Lookup', 'MISS');
				return newResponse;
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
