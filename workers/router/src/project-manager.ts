import type { ProjectMetadata } from './types';
import type AssetApi from '../../asset-service/src/worker';
import { listAllKeys } from './util/kv';
import { createProjectRequestSchema } from './validation';
import { z } from 'zod';
import { cachedKvGet, invalidateKvCache } from './kv-cache';

// Pagination constants
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

/**
 * Creates a new project with a unique ID and stores it in KV.
 *
 * @param request - The incoming HTTP request containing optional project name in JSON body
 * @param projectsKv - The KV namespace for storing project metadata
 * @returns JSON response with the created project metadata (HTTP 201)
 */
export async function createProject(request: Request, projectsKv: KVNamespace): Promise<Response> {
	const bodyJson = await request.json();

	// Validate payload using Zod
	const bodyValidation = createProjectRequestSchema.safeParse(bodyJson);
	if (!bodyValidation.success) {
		return new Response(
			JSON.stringify({
				success: false,
				error: z.prettifyError(bodyValidation.error),
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		);
	}

	const body = bodyValidation.data;

	const projectId = crypto.randomUUID();

	const project: ProjectMetadata = {
		id: projectId,
		name: body.name || `Project ${projectId}`,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		hasServerCode: false,
		assetsCount: 0,
	};

	await projectsKv.put(`project:${projectId}`, JSON.stringify(project));

	return new Response(
		JSON.stringify({
			success: true,
			project,
		}),
		{
			status: 201,
			headers: { 'Content-Type': 'application/json' },
		},
	);
}

export interface ListProjectsOptions {
	limit?: number;
	cursor?: string;
}

/**
 * Lists all projects with pagination support.
 *
 * @param projectsKv - The KV namespace for storing project metadata
 * @param options - Pagination options including limit and optional cursor
 * @returns JSON response with projects array and pagination metadata
 */
export async function listProjects(projectsKv: KVNamespace, options: ListProjectsOptions = {}): Promise<Response> {
	const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
	const cursor = options.cursor || undefined;

	const result = await projectsKv.list({
		prefix: 'project:',
		limit,
		cursor,
	});
	const { keys, list_complete } = result;
	const nextCursor = list_complete ? null : result.cursor;

	const projects = await Promise.all(
		keys.map(async (key: { name: string }) => {
			return await cachedKvGet<ProjectMetadata>(projectsKv, key.name, 'projects', { type: 'json' });
		}),
	);

	return new Response(
		JSON.stringify({
			success: true,
			projects: projects.filter((p: ProjectMetadata | null) => p !== null),
			pagination: {
				nextCursor,
				hasMore: !list_complete,
				limit,
			},
		}),
		{
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		},
	);
}

/**
 * Retrieves project information by ID.
 *
 * @param projectId - The unique identifier of the project
 * @param projectsKv - The KV namespace for storing project metadata
 * @returns JSON response with project metadata or 404 if not found
 */
export async function getProjectInfo(projectId: string, projectsKv: KVNamespace): Promise<Response> {
	const project = await getProject(projectId, projectsKv);

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
		},
	);
}

/**
 * Deletes a project and all associated resources including assets and server code.
 *
 * @param projectId - The unique identifier of the project to delete
 * @param projectsKv - The KV namespace for storing project metadata
 * @param serverCodeKv - The KV namespace for storing server code modules
 * @param assetWorker - The asset service worker for deleting project assets
 * @returns JSON response with deletion statistics or 404 if project not found
 */
export async function deleteProject(
	projectId: string,
	projectsKv: KVNamespace,
	serverCodeKv: KVNamespace,
	assetWorker: Service<AssetApi>,
): Promise<Response> {
	const project = await getProject(projectId, projectsKv);

	if (!project) {
		return new Response('Project not found', { status: 404 });
	}

	// Delete assets and manifest via AssetApi RPC
	const assetDeletion = await assetWorker.deleteProjectAssets(projectId);

	// Delete server code if exists (modules + manifest)
	let deletedServerCodeModules = 0;
	if (project.hasServerCode) {
		const serverCodePrefix = getServerCodePrefix(projectId);

		// Delete all server code modules and manifest using pagination
		for await (const key of listAllKeys(serverCodeKv, { prefix: serverCodePrefix })) {
			await serverCodeKv.delete(key.name);
			deletedServerCodeModules++;
		}
	}

	// Delete project metadata
	await projectsKv.delete(`project:${projectId}`);
	// Invalidate project cache
	await invalidateKvCache('projects', `project:${projectId}`);

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
		},
	);
}

/**
 * Retrieves project metadata from KV storage.
 *
 * @param projectId - The unique identifier of the project
 * @param projectsKv - The KV namespace for storing project metadata
 * @returns The project metadata or null if not found
 */
export async function getProject(projectId: string, projectsKv: KVNamespace): Promise<ProjectMetadata | null> {
	return await cachedKvGet<ProjectMetadata>(projectsKv, `project:${projectId}`, 'projects', { type: 'json' });
}

/**
 * Generates the KV key prefix for a project's server code.
 *
 * @param projectId - The unique identifier of the project
 * @returns The prefix string used for server code KV keys
 */
export function getServerCodePrefix(projectId: string): string {
	return `${projectId}:`;
}

/**
 * Generates a namespaced KV key for server code storage.
 *
 * @param projectId - The unique identifier of the project
 * @param key - The key to namespace (e.g., content hash or 'MANIFEST')
 * @returns The full namespaced key for KV storage
 */
export function getServerCodeKey(projectId: string, key: string): string {
	return `${projectId}:${key}`;
}
