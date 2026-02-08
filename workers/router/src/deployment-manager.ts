import * as base64 from '@stablelib/base64';
import { z } from 'zod';

import { computeContentHash, inferModuleType } from './content-utilities';
import { verifyJWT } from './jwt';
import { getProject, getServerCodeKey } from './project-manager';
import { deploymentPayloadSchema } from './validation';
import AssetWorker, { ManifestEntry } from '../../asset-service/src/worker';
import { batchExistsKv } from '../../shared/kv';

import type { ServerCodeManifest, ModuleType, CompletionJwtPayload } from './types';

/**
 * Deploys a full-stack project with assets and optional server code.
 * This is Phase 3 of the deployment flow, finalizing with a completion JWT.
 *
 * @param projectId - The unique identifier of the project to deploy
 * @param request - The HTTP request containing the deployment payload
 * @param projectsKv - The KV namespace for storing project metadata
 * @param serverCodeKv - The KV namespace for storing server code modules
 * @param assetWorker - The asset service worker for uploading manifests
 * @param jwtSecret - The secret used for JWT verification
 * @returns JSON response with deployment statistics or error response
 */
export async function deployProject(
	projectId: string,
	request: Request,
	projectsKv: KVNamespace,
	serverCodeKv: KVNamespace,
	assetWorker: Service<AssetWorker>,
	jwtSecret: string,
): Promise<Response> {
	const project = await getProject(projectId, projectsKv);

	if (!project) {
		return new Response('Project not found', { status: 404 });
	}

	if (project.status === 'READY') {
		return new Response('Project already deployed. Projects are immutable after deployment — create a new project instead.', {
			status: 409,
		});
	}

	const payloadJson = await request.json();

	// Validate payload using Zod
	const payloadValidation = deploymentPayloadSchema.safeParse(payloadJson);
	if (!payloadValidation.success) {
		return new Response(z.prettifyError(payloadValidation.error), { status: 400 });
	}

	const payload = payloadValidation.data;

	try {
		const manifestEntries: ManifestEntry[] = [];
		let newEntries: ManifestEntry[] = [];

		// Handle assets deployment with completion JWT
		if (payload.completionJwt) {
			// Verify completion JWT
			const jwtPayload = await verifyJWT<CompletionJwtPayload>(payload.completionJwt, jwtSecret);
			if (!jwtPayload || jwtPayload.phase !== 'complete' || jwtPayload.projectId !== projectId) {
				return new Response('Invalid or expired completion JWT', { status: 401 });
			}

			// Check if session still exists and has the completion token
			// This prevents JWT reuse after the session expires
			const sessionKey = `upload-session/${projectId}/${jwtPayload.sessionId}`;
			const sessionData = await projectsKv.get(sessionKey, { type: 'text' });
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
			const manifest = jwtPayload.manifest;

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
			const moduleEntries: { path: string; hash: string; content: ArrayBuffer; type: ModuleType }[] = [];

			for (const [modulePath, moduleData] of Object.entries(payload.serverCode.modules)) {
				// Handle both formats: string (base64) or { content: base64, type: ModuleType }
				const base64Content = typeof moduleData === 'string' ? moduleData : moduleData.content;
				// Infer type from file extension
				const moduleType: ModuleType = typeof moduleData === 'object' && moduleData.type ? moduleData.type : inferModuleType(modulePath);

				// Decode once and reuse for both hashing and uploading
				const decodedContent = new Uint8Array(base64.decode(base64Content)).buffer;
				const contentHash = await computeContentHash(decodedContent);
				moduleManifest[modulePath] = { hash: contentHash, type: moduleType };
				totalServerCodeModules++;

				moduleEntries.push({ path: modulePath, hash: contentHash, content: decodedContent, type: moduleType });
			}

			// Batch-check which modules already exist in KV (chunked into batches of 100)
			const moduleKeys = moduleEntries.map(({ hash }) => getServerCodeKey(projectId, hash));
			const existingModules = await batchExistsKv(serverCodeKv, moduleKeys);

			// Only upload modules that don't already exist
			const modulesToUpload: { hash: string; content: ArrayBuffer; type: ModuleType }[] = [];
			for (const entry of moduleEntries) {
				const moduleKey = getServerCodeKey(projectId, entry.hash);
				if (!existingModules.has(moduleKey)) {
					modulesToUpload.push({
						hash: entry.hash,
						content: entry.content,
						type: entry.type,
					});
				}
			}

			newServerCodeModules = modulesToUpload.length;

			// Upload new modules (stored as raw binary)
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
		}

		// Re-check project still exists before finalizing (prevents resurrecting a deleted project)
		const currentProject = await getProject(projectId, projectsKv);
		if (!currentProject) {
			return new Response('Project was deleted during deployment', { status: 404 });
		}

		// Apply deployment changes to the freshly-fetched project to avoid overwriting concurrent updates
		if (payload.projectName) {
			currentProject.name = payload.projectName;
		}
		currentProject.updatedAt = new Date().toISOString();
		if (payload.completionJwt) {
			currentProject.assetsCount = manifestEntries.length;
		}
		if (payload.config) {
			currentProject.config = payload.config;
		}
		if (payload.run_worker_first !== undefined) {
			currentProject.run_worker_first = payload.run_worker_first;
		}
		if (payload.serverCode) {
			currentProject.hasServerCode = true;
		}

		// Mark status as READY
		currentProject.status = 'READY';

		await projectsKv.put(`project/${projectId}/metadata`, JSON.stringify(currentProject));

		return Response.json(
			{
				success: true,
				message: 'Project deployed successfully',
				project: currentProject,
				deployedAssets: manifestEntries.length,
				newAssets: newEntries.length,
				skippedAssets: manifestEntries.length - newEntries.length,
				deployedServerCodeModules: totalServerCodeModules,
				newServerCodeModules,
				skippedServerCodeModules: totalServerCodeModules - newServerCodeModules,
			},
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (error) {
		// Mark status as ERROR and persist (only if project still exists to avoid resurrection)
		const stillExists = await getProject(projectId, projectsKv);
		if (stillExists) {
			stillExists.status = 'ERROR';
			stillExists.updatedAt = new Date().toISOString();
			await projectsKv.put(`project/${projectId}/metadata`, JSON.stringify(stillExists));
		}

		// Re-throw to be handled by the caller or return error response
		// Since this is the handler, we should probably return a response
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return Response.json(
			{
				success: false,
				error: `Deployment failed: ${errorMessage}`,
			},
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
}
