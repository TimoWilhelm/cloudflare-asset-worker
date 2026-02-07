import type AssetApi from '../../asset-service/src/worker';
import { deleteProject, listProjects } from './project-manager';
import { ProjectMetadata } from './types';

/**
 * Runs all scheduled maintenance tasks.
 *
 * @param env - The worker environment bindings
 */
export async function runWatchdog(env: Env): Promise<void> {
	console.log('🐶 Watchdog started');
	const startTime = performance.now();

	await cleanupStaleDeployments(env);

	const duration = performance.now() - startTime;
	console.log(`🐶 Watchdog finished in ${duration.toFixed(2)}ms`);
}

/**
 * Cleans up deployments that are in a stale or error state.
 *
 * Cleanup criteria:
 * 1. Status is 'PENDING' and created > 30 minutes ago.
 * 2. Status is 'ERROR'.
 * 3. Status is missing (legacy/undefined) -> Treated as invalid/incomplete per strict mode.
 *
 * @param env - The worker environment bindings
 */
async function cleanupStaleDeployments(env: Env): Promise<void> {
	const projectsKv = env.KV_PROJECTS;
	const serverCodeKv = env.KV_SERVER_CODE;
	const assetWorker = env.ASSET_WORKER as Service<AssetApi>;

	// List all projects (pagination might be needed if > 1000 projects, but for now we do one batch)
	// Ideally we would iterate all keys, but let's stick to the listProjects helper or direct listing if helper is paginated
	// listProjects helper fetches values which is good for checking status.
	// For a robust implementation with many projects, we should stream keys.
	// Given the scope, let's use listProjects with a higher limit or loop.
	// For this task, I'll loop until no more cursor.

	let cursor: string | undefined = undefined;
	let hasMore = true;
	let deletedCount = 0;

	console.log('🧹 Starting cleanup of stale deployments...');

	while (hasMore) {
		const result = await listProjects(projectsKv, { limit: 100, cursor });
		const responseData = (await result.json()) as {
			projects: ProjectMetadata[];
			pagination: { nextCursor: string | null; hasMore: boolean };
		};

		const projects = responseData.projects;

		for (const project of projects) {
			let shouldDelete = false;
			let reason = '';

			// Check for missing status (breaking change: invalid)
			if (!project.status) {
				shouldDelete = true;
				reason = 'Missing status (Legacy/Invalid)';
			}
			// Check for ERROR status (with grace period)
			else if (project.status === 'ERROR') {
				const updatedAt = new Date(project.updatedAt).getTime();
				const now = Date.now();
				const ageInMinutes = (now - updatedAt) / (1000 * 60);

				if (ageInMinutes > 30) {
					shouldDelete = true;
					reason = `Deployment failed (ERROR state, ${ageInMinutes.toFixed(0)}m old)`;
				}
			}
			// Check for stale PENDING status (> 30 mins)
			else if (project.status === 'PENDING') {
				const createdAt = new Date(project.createdAt).getTime();
				const now = Date.now();
				const ageInMinutes = (now - createdAt) / (1000 * 60);

				if (ageInMinutes > 30) {
					shouldDelete = true;
					reason = `Stale PENDING state (${ageInMinutes.toFixed(0)}m old)`;
				}
			}

			if (shouldDelete) {
				console.log(`🗑️ Deleting project ${project.id} (${project.name}): ${reason}`);
				await deleteProject(project.id, projectsKv, serverCodeKv, assetWorker);
				deletedCount++;
			}
		}

		cursor = responseData.pagination.nextCursor || undefined;
		hasMore = responseData.pagination.hasMore;
	}

	console.log(`✅ Cleanup complete. Deleted ${deletedCount} projects.`);
}
