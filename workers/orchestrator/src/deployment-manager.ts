import type { DeploymentPayload, ProjectMetadata, ServerCodeManifest, ModuleType } from './types';
import type AssetApi from '../../asset-service/src/worker';
import type { ManifestEntry } from '../../asset-service/src/worker';
import * as base64 from '@stablelib/base64';
import { computeContentHash, inferModuleType } from './content-utils';
import { verifyJWT } from './jwt';
import { getProject, getServerCodeKey } from './project-manager';

/**
 * Deploy a full-stack project (assets + optional server code)
 * Phase 3: Finalize deployment with completion JWT
 */
export async function deployProject(
	projectId: string,
	request: Request,
	projectsKv: KVNamespace,
	serverCodeKv: KVNamespace,
	assetWorker: Service<AssetApi>,
	jwtSecret: string,
): Promise<Response> {
	const project = await getProject(projectId, projectsKv);

	if (!project) {
		return new Response('Project not found', { status: 404 });
	}

	const payload = await request.json<DeploymentPayload>();

	// Update project name if provided
	if (payload.projectName) {
		project.name = payload.projectName;
	}

	let manifestEntries: ManifestEntry[] = [];
	let newEntries: ManifestEntry[] = [];

	// Handle assets deployment with completion JWT
	if (payload.completionJwt) {
		// Verify completion JWT
		const jwtPayload = await verifyJWT(payload.completionJwt, jwtSecret);
		if (!jwtPayload || jwtPayload.phase !== 'complete' || jwtPayload.projectId !== projectId) {
			return new Response('Invalid or expired completion JWT', { status: 401 });
		}

		// Check if session still exists and has the completion token
		// This prevents JWT reuse after the session expires
		const sessionKey = `session:${jwtPayload.sessionId}`;
		const sessionData = await projectsKv.get(sessionKey, 'text');
		if (!sessionData) {
			// Session expired - JWT may have been used already or is too old
			return new Response('Upload session expired', { status: 401 });
		}

		const session = JSON.parse(sessionData);
		if (session.completionToken !== payload.completionJwt) {
			return new Response('Invalid completion JWT', { status: 401 });
		}

		// Delete session after successful verification to prevent reuse
		await projectsKv.delete(sessionKey);

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
		newEntries = await assetWorker.uploadManifest(manifestEntries, projectId);
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
				moduleType = inferModuleType(modulePath);
			}

			// Compute hash from base64 content (content-addressed storage)
			const contentHash = await computeContentHash(base64.decode(base64Content));
			moduleManifest[modulePath] = { hash: contentHash, type: moduleType };
			totalServerCodeModules++;

			// Check if module already exists in KV
			const moduleKey = getServerCodeKey(projectId, contentHash);
			const existingModule = await serverCodeKv.get(moduleKey);

			if (!existingModule) {
				// Store base64-encoded content in KV
				modulesToUpload.push({ hash: contentHash, content: base64Content, type: moduleType });
			}
		}

		newServerCodeModules = modulesToUpload.length;

		// Upload new modules (stored as base64)
		await Promise.all(
			modulesToUpload.map(async ({ hash, content }) => {
				const moduleKey = getServerCodeKey(projectId, hash);
				await serverCodeKv.put(moduleKey, content);
			}),
		);

		// Store the manifest
		const manifest: ServerCodeManifest = {
			entrypoint: payload.serverCode.entrypoint,
			modules: moduleManifest,
			compatibilityDate: payload.serverCode.compatibilityDate || '2025-11-09',
			env: { ...payload.env },
		};

		const manifestKey = getServerCodeKey(projectId, 'MANIFEST');
		await serverCodeKv.put(manifestKey, JSON.stringify(manifest));
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

	await projectsKv.put(`project:${projectId}`, JSON.stringify(project));

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
		},
	);
}
