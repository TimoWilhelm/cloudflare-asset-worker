import { deleteProject, listProjectsData } from './project-manager';
import { RouterEnvironment } from './types';

/**
 * Runs all scheduled maintenance tasks.
 *
 * @param env - The worker environment bindings
 */
export async function runWatchdog(environment: RouterEnvironment): Promise<void> {
	console.log('🐶 Watchdog started');
	const startTime = performance.now();

	await cleanupStaleDeployments(environment);

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
async function cleanupStaleDeployments(environment: RouterEnvironment): Promise<void> {
	const projectsKv = environment.KV_PROJECTS;
	const serverSideCodeKv = environment.KV_SERVER_SIDE_CODE;
	const assetWorker = environment.ASSET_WORKER;

	let cursor: string | undefined = undefined;
	let hasMore = true;
	let deletedCount = 0;

	console.log('🧹 Starting cleanup of stale deployments...');

	while (hasMore) {
		const typedResponse = await listProjectsData(projectsKv, { limit: 100, cursor });

		const projects = typedResponse.projects;

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
				if (Number.isNaN(updatedAt)) {
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
				if (Number.isNaN(createdAt)) {
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
					await deleteProject(project.id, projectsKv, serverSideCodeKv, assetWorker);
					deletedCount++;
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					console.error(`❌ Failed to delete project ${project.id}: ${errorMessage}`);
				}
			}
		}

		cursor = typedResponse.pagination.nextCursor;
		hasMore = typedResponse.pagination.hasMore;
	}

	console.log(`✅ Cleanup complete. Deleted ${deletedCount} projects.`);
}
