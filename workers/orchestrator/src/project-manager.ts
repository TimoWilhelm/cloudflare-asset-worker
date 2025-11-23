import type { ProjectMetadata } from './types';
import type AssetApi from '../../asset-service/src/worker';
import { listAllKeys } from './util/kv';

/**
 * Create a new project
 */
export async function createProject(request: Request, projectsKv: KVNamespace): Promise<Response> {
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

/**
 * List all projects
 */
export async function listProjects(projectsKv: KVNamespace): Promise<Response> {
	const { keys } = await projectsKv.list({ prefix: 'project:', limit: 100 });

	const projects = await Promise.all(
		keys.map(async (key: { name: string }) => {
			return await projectsKv.get<ProjectMetadata>(key.name, 'json');
		}),
	);

	return new Response(
		JSON.stringify({
			success: true,
			projects: projects.filter((p: ProjectMetadata | null) => p !== null),
		}),
		{
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		},
	);
}

/**
 * Get project information
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
 * Delete a project and its metadata
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
 * Get project metadata from KV
 */
export async function getProject(projectId: string, projectsKv: KVNamespace): Promise<ProjectMetadata | null> {
	return await projectsKv.get<ProjectMetadata>(`project:${projectId}`, 'json');
}

/**
 * Get the server code prefix for a project
 */
export function getServerCodePrefix(projectId: string): string {
	return `${projectId}:`;
}

/**
 * Get the namespaced key for server code
 */
export function getServerCodeKey(projectId: string, key: string): string {
	return `${projectId}:${key}`;
}
