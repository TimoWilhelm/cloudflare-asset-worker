import { z } from 'zod';

import { createProjectRequestSchema } from './validation';
import { deleteAllKeys } from '../../shared/kv';

import type { ProjectMetadata } from './types';
import type AssetApi from '../../asset-service/src/worker';

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
		return Response.json(
			{
				success: false,
				error: z.prettifyError(bodyValidation.error),
			},
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		);
	}

	const body = bodyValidation.data;

	const projectId = crypto.randomUUID();

	const project: ProjectMetadata = {
		id: projectId,
		name: body.name || `Project ${projectId}`,
		status: 'PENDING',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		hasServerCode: false,
		assetsCount: 0,
	};

	// PENDING projects auto-expire after 1 hour if deployment never completes
	await projectsKv.put(`project/${projectId}/metadata`, JSON.stringify(project), { expirationTtl: 3600 });

	return Response.json(
		{
			success: true,
			project,
		},
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

export interface ListProjectsResult {
	projects: ProjectMetadata[];
	pagination: {
		nextCursor: string | undefined;
		hasMore: boolean;
		limit: number;
	};
}

/**
 * Core listing logic that returns data directly.
 * Uses the 'project-metadata/' prefix to list only metadata keys,
 * avoiding pollution from module keys that share the 'project/' prefix.
 *
 * @param projectsKv - The KV namespace for storing project metadata
 * @param options - Pagination options including limit and optional cursor
 * @returns Object with projects array and pagination metadata
 */
export async function listProjectsData(projectsKv: KVNamespace, options: ListProjectsOptions = {}): Promise<ListProjectsResult> {
	const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

	// Decode composite cursor: "kvCursor:skip" or just "skip" when KV listing
	// completed but there are still metadata keys to paginate through.
	let kvCursor: string | undefined;
	let skip = 0;
	if (options.cursor) {
		const separatorIndex = options.cursor.indexOf(':');
		if (separatorIndex === -1) {
			skip = Number.parseInt(options.cursor, 10) || 0;
		} else {
			kvCursor = options.cursor.slice(0, separatorIndex) || undefined;
			skip = Number.parseInt(options.cursor.slice(separatorIndex + 1), 10) || 0;
		}
	}

	// Collect metadata keys across multiple KV list pages.
	// The 'project/' prefix also matches module keys (project/{id}/module/...),
	// so a single KV list page may contain few or no metadata keys.
	// We always consume full KV pages and collect all metadata keys we find.
	// This avoids the complexity of mid-page cursors which can cause duplicates.
	const needed = skip + limit + 1;
	const metadataKeys: { name: string }[] = [];
	let innerCursor = kvCursor;
	let listComplete = false;

	while (metadataKeys.length < needed && !listComplete) {
		const result = await projectsKv.list({
			prefix: 'project/',
			limit: 1000,
			cursor: innerCursor,
		});

		for (const key of result.keys) {
			if (key.name.endsWith('/metadata')) {
				metadataKeys.push(key);
			}
		}

		if (result.list_complete) {
			listComplete = true;
		} else {
			innerCursor = result.cursor;
		}
	}

	// Skip already-returned metadata keys from previous pages
	const remaining = metadataKeys.slice(skip);
	const hasMore = remaining.length > limit || !listComplete;
	const truncatedKeys = remaining.slice(0, limit);

	// Build next cursor: encode KV cursor + new skip offset
	let nextCursor: string | undefined;
	if (hasMore) {
		const newSkip = skip + limit;
		nextCursor = listComplete ? `${newSkip}` : `${innerCursor ?? ''}:${newSkip}`;
	}

	const projects = await Promise.all(
		truncatedKeys.map(async (key: { name: string }) => {
			return await projectsKv.get<ProjectMetadata>(key.name, { type: 'json' });
		}),
	);

	return {
		projects: projects.filter((p: ProjectMetadata | null): p is ProjectMetadata => p !== null),
		pagination: {
			nextCursor,
			hasMore,
			limit,
		},
	};
}

/**
 * Lists all projects with pagination support.
 *
 * @param projectsKv - The KV namespace for storing project metadata
 * @param options - Pagination options including limit and optional cursor
 * @returns JSON response with projects array and pagination metadata
 */
export async function listProjects(projectsKv: KVNamespace, options: ListProjectsOptions = {}): Promise<Response> {
	const data = await listProjectsData(projectsKv, options);

	return Response.json(
		{
			success: true,
			...data,
		},
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

	return Response.json(
		{
			success: true,
			project,
		},
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
		deletedServerCodeModules = await deleteAllKeys(serverCodeKv, { prefix: serverCodePrefix });
	}

	// Delete any remaining upload sessions for this project
	await deleteAllKeys(projectsKv, { prefix: `upload-session/${projectId}/` });

	// Delete project metadata
	await projectsKv.delete(`project/${projectId}/metadata`);

	return Response.json(
		{
			success: true,
			message: 'Project deleted',
			deletedAssets: assetDeletion.deletedAssets,
			deletedManifest: assetDeletion.deletedManifest,
			deletedServerCode: project.hasServerCode,
			deletedServerCodeModules,
		},
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
	return await projectsKv.get<ProjectMetadata>(`project/${projectId}/metadata`, { type: 'json' });
}

/**
 * Generates the KV key prefix for a project's server code.
 *
 * @param projectId - The unique identifier of the project
 * @returns The prefix string used for server code KV keys
 */
export function getServerCodePrefix(projectId: string): string {
	return `project/${projectId}/module/`;
}

/**
 * Generates a namespaced KV key for server code storage.
 *
 * @param projectId - The unique identifier of the project
 * @param key - The key to namespace (e.g., content hash or 'MANIFEST')
 * @returns The full namespaced key for KV storage
 */
export function getServerCodeKey(projectId: string, key: string): string {
	return `project/${projectId}/module/${key}`;
}
