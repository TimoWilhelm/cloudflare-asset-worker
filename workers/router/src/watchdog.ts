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
 * 2. Status is 'ERROR' and updated > 30 minutes ago.
 * 3. Status is missing (legacy/undefined) -> Treated as invalid/incomplete.
 *
 * @param env - The worker environment bindings
 */
async function cleanupStaleDeployments(env: Env): Promise<void> {
	const projectsKv = env.KV_PROJECTS;
	const serverCodeKv = env.KV_SERVER_CODE;
	const assetWorker = env.ASSET_WORKER as Service<AssetApi>;

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

			if (!project.status || !['PENDING', 'READY', 'ERROR'].includes(project.status)) {
				// Missing or unknown status — treat as invalid/incomplete
				shouldDelete = true;
				reason = `Invalid or missing status: '${project.status ?? 'undefined'}'`;
			} else if (project.status === 'ERROR') {
				// Check for ERROR status (with grace period)
				const updatedAt = new Date(project.updatedAt).getTime();
				if (isNaN(updatedAt)) {
					shouldDelete = true;
					reason = 'ERROR state with invalid updatedAt timestamp';
				} else {
					const ageInMinutes = (Date.now() - updatedAt) / (1000 * 60);
					if (ageInMinutes > 30) {
						shouldDelete = true;
						reason = `Deployment failed (ERROR state, ${ageInMinutes.toFixed(0)}m old)`;
					}
				}
			} else if (project.status === 'PENDING') {
				// Check for stale PENDING status (> 30 mins)
				const createdAt = new Date(project.createdAt).getTime();
				if (isNaN(createdAt)) {
					shouldDelete = true;
					reason = 'PENDING state with invalid createdAt timestamp';
				} else {
					const ageInMinutes = (Date.now() - createdAt) / (1000 * 60);
					if (ageInMinutes > 30) {
						shouldDelete = true;
						reason = `Stale PENDING state (${ageInMinutes.toFixed(0)}m old)`;
					}
				}
			}

			if (shouldDelete) {
				try {
					console.log(`🗑️ Deleting project ${project.id} (${project.name}): ${reason}`);
					await deleteProject(project.id, projectsKv, serverCodeKv, assetWorker);
					deletedCount++;
				} catch (err) {
					const errorMessage = err instanceof Error ? err.message : String(err);
					console.error(`❌ Failed to delete project ${project.id}: ${errorMessage}`);
				}
			}
		}

		cursor = responseData.pagination.nextCursor || undefined;
		hasMore = responseData.pagination.hasMore;
	}

	console.log(`✅ Cleanup complete. Deleted ${deletedCount} projects.`);
}
