import * as base64 from '@stablelib/base64';
import { z } from 'zod';

import { computeContentHash, guessContentType, createBuckets } from './content-utilities';
import { generateJWT, verifyJWT } from './jwt';
import { getProject } from './project-manager';
import { assetManifestRequestSchema, uploadPayloadSchema } from './validation';
import AssetWorker from '../../asset-service/src/worker';

import type { UploadSession } from './types';

/**
 * Creates an asset upload session for a project.
 * This is Phase 1 of the upload flow: registers the manifest and returns upload instructions.
 *
 * @param projectId - The unique identifier of the project
 * @param request - The HTTP request containing the asset manifest
 * @param projectsKv - The KV namespace for storing session data
 * @param assetWorker - The asset service worker for checking existing assets
 * @param jwtSecret - The secret used for JWT generation
 * @returns JSON response with upload JWT and buckets, or completion JWT if all assets exist
 */
export async function createAssetUploadSession(
	projectId: string,
	request: Request,
	projectsKv: KVNamespace,
	assetWorker: Service<AssetWorker>,
	jwtSecret: string,
): Promise<Response> {
	const project = await getProject(projectId, projectsKv);

	if (!project) {
		return new Response('Project not found', { status: 404 });
	}

	const payloadJson = await request.json();

	// Validate payload using Zod
	const payloadValidation = assetManifestRequestSchema.safeParse(payloadJson);
	if (!payloadValidation.success) {
		return new Response(z.prettifyError(payloadValidation.error), { status: 400 });
	}

	const { manifest } = payloadValidation.data;

	// Check which hashes already exist in KV via AssetApi's efficient checkAssetsExist method
	// This only uploads assets that are missing or have changed content hashes
	const allHashes = Object.values(manifest).map((entry) => entry.hash);
	const uniqueHashes = [...new Set(allHashes)];

	const existenceChecks = await assetWorker.checkAssetsExist(uniqueHashes, projectId);

	// Get hashes that need to be uploaded (assets that don't exist or have changed)
	const hashesToUpload = existenceChecks.filter(({ exists }) => !exists).map(({ hash }) => hash);

	// Create buckets (batch uploads for optimal performance)
	const buckets = createBuckets(hashesToUpload, 10); // Max 10 files per bucket

	// Create session
	const sessionId = crypto.randomUUID();
	const session: UploadSession = {
		sessionId,
		projectId,
		manifest,
		buckets,
		uploadedHashes: new Set(),
		createdAt: Date.now(),
	};

	// Generate JWT for upload phase
	const uploadJwt = await generateJWT({ sessionId, projectId, phase: 'upload' }, jwtSecret);

	// If all assets already exist with matching contentHash, skip upload phase entirely
	// and return completion token immediately for deployment
	if (buckets.length === 0) {
		const completionJwt = await generateJWT({ sessionId, projectId, phase: 'complete', manifest }, jwtSecret);
		session.completionToken = completionJwt;

		// Still need to store session for deployment phase to verify the completion token
		const sessionKey = `upload-session/${projectId}/${sessionId}`;
		await projectsKv.put(sessionKey, JSON.stringify({ ...session, uploadedHashes: [...session.uploadedHashes] }), {
			expirationTtl: 3600, // 1 hour
		});

		return Response.json(
			{
				result: {
					jwt: completionJwt,
					buckets: [],
				},
				success: true,
				errors: undefined,
				messages: undefined,
			},
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	// Store session in KV with 1 hour expiration
	const sessionKey = `upload-session/${projectId}/${sessionId}`;
	await projectsKv.put(sessionKey, JSON.stringify({ ...session, uploadedHashes: [...session.uploadedHashes] }), {
		expirationTtl: 3600, // 1 hour
	});

	return Response.json(
		{
			result: {
				jwt: uploadJwt,
				buckets,
			},
			success: true,
			errors: undefined,
			messages: undefined,
		},
		{
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		},
	);
}

/**
 * Uploads assets in buckets with JWT authentication.
 * This is Phase 2 of the upload flow: uploads files and returns completion JWT when done.
 *
 * @param projectId - The unique identifier of the project
 * @param request - The HTTP request containing base64-encoded assets keyed by hash
 * @param projectsKv - The KV namespace for storing session data
 * @param assetWorker - The asset service worker for uploading assets
 * @param jwtSecret - The secret used for JWT verification and generation
 * @returns JSON response with completion JWT when all uploads finish, or success status for partial uploads
 */
export async function uploadAssets(
	projectId: string,
	request: Request,
	projectsKv: KVNamespace,
	assetWorker: Service<AssetWorker>,
	jwtSecret: string,
): Promise<Response> {
	// Extract JWT from Authorization header
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return new Response('Missing or invalid Authorization header', { status: 401 });
	}

	const jwt = authHeader.slice(7);
	const jwtPayload = await verifyJWT(jwt, jwtSecret);

	if (!jwtPayload || jwtPayload.phase !== 'upload' || jwtPayload.projectId !== projectId) {
		return new Response('Invalid or expired JWT', { status: 401 });
	}

	// Verify project still exists (may have been deleted or cleaned up)
	const project = await getProject(projectId, projectsKv);
	if (!project) {
		return new Response('Project not found', { status: 404 });
	}

	// Load session
	const sessionKey = `upload-session/${projectId}/${jwtPayload.sessionId}`;
	const sessionData = await projectsKv.get(sessionKey, { type: 'text' });
	if (!sessionData) {
		return new Response('Session expired or not found', { status: 404 });
	}

	const session: UploadSession = JSON.parse(sessionData);
	session.uploadedHashes = new Set(session.uploadedHashes); // Restore Set from JSON

	// Build reverse index: hash -> { pathname, size } for O(1) lookups
	// If multiple pathnames share a hash, keep the first one (sizes must match for the same content hash)
	const hashIndex = new Map<string, { pathname: string; size: number }>();
	for (const [pathname, data] of Object.entries(session.manifest)) {
		if (!hashIndex.has(data.hash)) {
			hashIndex.set(data.hash, { pathname, size: data.size });
		}
	}

	// Parse body - expecting JSON with base64 encoded files
	const payload = await request.json();

	// Validate payload using Zod
	const payloadValidation = uploadPayloadSchema.safeParse(payload);
	if (!payloadValidation.success) {
		return new Response(z.prettifyError(payloadValidation.error), { status: 400 });
	}

	// Upload each asset
	for (const [hash, base64Content] of Object.entries(payloadValidation.data)) {
		// Verify hash is in the manifest
		const indexEntry = hashIndex.get(hash);
		if (!indexEntry) {
			return new Response(`Hash ${hash} not found in manifest`, { status: 400 });
		}

		// Prevent duplicate uploads in the same session
		if (session.uploadedHashes.has(hash)) {
			return new Response(`Hash ${hash} already uploaded in this session`, { status: 400 });
		}

		// Decode base64
		const content = base64.decode(base64Content);

		// Verify the uploaded content matches the claimed hash
		const actualHash = await computeContentHash(content);
		if (actualHash !== hash) {
			return new Response(`Content hash mismatch: expected ${hash}, got ${actualHash}`, { status: 400 });
		}

		// Verify size matches manifest
		if (content.length !== indexEntry.size) {
			return new Response(`Size mismatch for ${indexEntry.pathname}: expected ${indexEntry.size}, got ${content.length}`, { status: 400 });
		}

		// Find content type for this hash
		const contentType = guessContentType(indexEntry.pathname);

		// Upload to KV via AssetApi
		// new Uint8Array() ensures a copy is made and returns an underlying ArrayBuffer, avoiding SharedArrayBuffer issues
		await assetWorker.uploadAsset(actualHash, new Uint8Array(content).buffer, projectId, contentType);
		session.uploadedHashes.add(hash);
	}

	// Check if all buckets are uploaded
	const allHashesInBuckets = session.buckets.flat();
	const allUploaded = allHashesInBuckets.every((hash) => session.uploadedHashes.has(hash));

	// Update session
	await projectsKv.put(sessionKey, JSON.stringify({ ...session, uploadedHashes: [...session.uploadedHashes] }), {
		expirationTtl: 3600,
	});

	// If all uploads complete, return completion JWT
	if (allUploaded) {
		const completionJwt = await generateJWT(
			{
				sessionId: session.sessionId,
				projectId,
				phase: 'complete',
				manifest: session.manifest,
			},
			jwtSecret,
		);

		// Update session with completion token
		session.completionToken = completionJwt;
		await projectsKv.put(sessionKey, JSON.stringify({ ...session, uploadedHashes: [...session.uploadedHashes] }), {
			expirationTtl: 3600,
		});

		return Response.json(
			{
				result: {
					jwt: completionJwt,
				},
				success: true,
				errors: undefined,
				messages: undefined,
			},
			{
				status: 201,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	// More uploads pending
	return Response.json(
		{
			result: {
				jwt: undefined,
			},
			success: true,
			errors: undefined,
			messages: undefined,
		},
		{
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		},
	);
}
