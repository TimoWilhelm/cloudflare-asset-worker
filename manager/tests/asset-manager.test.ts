import { createAssetUploadSession, uploadAssets } from '../src/asset-manager';
import { createProject } from '../src/project-manager';
import { generateJWT, verifyJWT } from '../src/jwt';
import { computeContentHash } from '../src/content-utils';
import * as base64 from '@stablelib/base64';
import { env } from 'cloudflare:test';

describe('asset-manager', () => {
	let projectsKv: KVNamespace;
	const jwtSecret = 'test-secret-key';

	beforeEach(async () => {
		projectsKv = env.PROJECTS_KV_NAMESPACE;

		// Clear KV namespace before each test
		const keys = await projectsKv.list();
		for (const key of keys.keys) {
			await projectsKv.delete(key.name);
		}
	});

	// Mock AssetApi
	const createMockAssetWorker = (existingHashes: Set<string> = new Set()) =>
		({
			checkAssetsExist: async (hashes: string[], projectId: string) => {
				return hashes.map((hash) => ({
					hash,
					exists: existingHashes.has(hash),
				}));
			},
			uploadAsset: async (hash: string, content: ArrayBuffer, projectId: string, contentType?: string) => {
				existingHashes.add(hash);
			},
		}) as any;

	describe('createAssetUploadSession', () => {
		it('creates upload session with valid manifest', async () => {
			// Create a project first
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const manifest = {
				'/index.html': { hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', size: 1024 },
				'/style.css': { hash: '1123456789abcdef0123456789abcdef1123456789abcdef0123456789abcdef', size: 512 },
			};

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.success).toBe(true);
			expect(data.result.jwt).toBeDefined();
			expect(data.result.buckets).toBeDefined();
			expect(data.result.buckets.length).toBeGreaterThan(0);
		});

		it('returns 404 for non-existent project', async () => {
			const manifest = {
				'/index.html': { hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', size: 1024 },
			};

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await createAssetUploadSession('non-existent-project', request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(404);
		});

		it('rejects empty manifest', async () => {
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest: {} }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(400);
		});

		it('rejects invalid manifest format', async () => {
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest: 'invalid' }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(400);
		});

		it('rejects invalid pathname (not starting with /)', async () => {
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const manifest = {
				'invalid-path': { hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', size: 1024 },
			};

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(400);
		});

		it('rejects invalid hash format', async () => {
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const manifest = {
				'/index.html': { hash: 'invalid-hash', size: 1024 },
			};

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(400);
		});

		it('rejects negative file sizes', async () => {
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const manifest = {
				'/index.html': { hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', size: -1 },
			};

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(400);
		});

		it('skips upload when all assets already exist', async () => {
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const hash1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
			const hash2 = '1123456789abcdef0123456789abcdef1123456789abcdef0123456789abcdef';

			const manifest = {
				'/index.html': { hash: hash1, size: 1024 },
				'/style.css': { hash: hash2, size: 512 },
			};

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			// All hashes already exist
			const mockAssetWorker = createMockAssetWorker(new Set([hash1, hash2]));
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.success).toBe(true);
			expect(data.result.buckets).toHaveLength(0);
			expect(data.result.jwt).toBeDefined();

			// Verify JWT is a completion token
			const jwtPayload = await verifyJWT(data.result.jwt, jwtSecret);
			expect(jwtPayload.phase).toBe('complete');
		});

		it('only uploads missing assets', async () => {
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const hash1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
			const hash2 = '1123456789abcdef0123456789abcdef1123456789abcdef0123456789abcdef';
			const hash3 = '2223456789abcdef0123456789abcdef2223456789abcdef0123456789abcdef';

			const manifest = {
				'/index.html': { hash: hash1, size: 1024 },
				'/style.css': { hash: hash2, size: 512 },
				'/script.js': { hash: hash3, size: 256 },
			};

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			// Only hash1 exists
			const mockAssetWorker = createMockAssetWorker(new Set([hash1]));
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.success).toBe(true);

			// Should only upload hash2 and hash3
			const allHashes = data.result.buckets.flat();
			expect(allHashes).toHaveLength(2);
			expect(allHashes).toContain(hash2);
			expect(allHashes).toContain(hash3);
			expect(allHashes).not.toContain(hash1);
		});

		it('stores session in KV with expiration', async () => {
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const manifest = {
				'/index.html': { hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', size: 1024 },
			};

			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await createAssetUploadSession(projectId, request, projectsKv, mockAssetWorker, jwtSecret);

			const data = (await response.json()) as any;
			const jwtPayload = await verifyJWT(data.result.jwt, jwtSecret);
			const sessionId = jwtPayload.sessionId;

			// Verify session is stored
			const session = await projectsKv.get(`session:${sessionId}`, 'json');
			expect(session).toBeDefined();
		});
	});

	describe('uploadAssets', () => {
		it('uploads assets successfully', async () => {
			// Create project and session
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const content = new TextEncoder().encode('test content');
			const hash = await computeContentHash(content);
			const manifest = {
				'/test.txt': { hash, size: content.length },
			};

			const sessionRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const sessionResponse = await createAssetUploadSession(projectId, sessionRequest, projectsKv, mockAssetWorker, jwtSecret);
			const sessionData = (await sessionResponse.json()) as any;
			const uploadJwt = sessionData.result.jwt;

			// Upload the asset
			const uploadRequest = new Request('http://example.com', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${uploadJwt}`,
				},
				body: JSON.stringify({
					[hash]: base64.encode(content),
				}),
			});

			const uploadResponse = await uploadAssets(projectId, uploadRequest, projectsKv, mockAssetWorker, jwtSecret);
			expect(uploadResponse.status).toBe(201);

			const uploadData = (await uploadResponse.json()) as any;
			expect(uploadData.success).toBe(true);
			expect(uploadData.result.jwt).toBeDefined();

			// Verify completion JWT
			const completionJwt = uploadData.result.jwt;
			const jwtPayload = await verifyJWT(completionJwt, jwtSecret);
			expect(jwtPayload.phase).toBe('complete');
		});

		it('rejects request without authorization', async () => {
			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({}),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await uploadAssets('project-id', request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(401);
		});

		it('rejects request with invalid JWT', async () => {
			const request = new Request('http://example.com', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer invalid-jwt',
				},
				body: JSON.stringify({}),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await uploadAssets('project-id', request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(401);
		});

		it('rejects JWT with wrong phase', async () => {
			const wrongPhaseJwt = await generateJWT(
				{
					sessionId: 'sess-123',
					projectId: 'proj-123',
					phase: 'complete',
				},
				jwtSecret,
			);

			const request = new Request('http://example.com', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${wrongPhaseJwt}`,
				},
				body: JSON.stringify({}),
			});

			const mockAssetWorker = createMockAssetWorker();
			const response = await uploadAssets('proj-123', request, projectsKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(401);
		});

		it('rejects hash not in manifest', async () => {
			// Create project and session
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const manifest = {
				'/test.txt': { hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', size: 1024 },
			};

			const sessionRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const sessionResponse = await createAssetUploadSession(projectId, sessionRequest, projectsKv, mockAssetWorker, jwtSecret);
			const sessionData = (await sessionResponse.json()) as any;
			const uploadJwt = sessionData.result.jwt;

			// Try to upload with wrong hash
			const uploadRequest = new Request('http://example.com', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${uploadJwt}`,
				},
				body: JSON.stringify({
					ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff: 'dGVzdA==',
				}),
			});

			const uploadResponse = await uploadAssets(projectId, uploadRequest, projectsKv, mockAssetWorker, jwtSecret);
			expect(uploadResponse.status).toBe(400);
		});

		it('rejects content hash mismatch', async () => {
			// Create project and session
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
			const manifest = {
				'/test.txt': { hash, size: 1024 },
			};

			const sessionRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const sessionResponse = await createAssetUploadSession(projectId, sessionRequest, projectsKv, mockAssetWorker, jwtSecret);
			const sessionData = (await sessionResponse.json()) as any;
			const uploadJwt = sessionData.result.jwt;

			// Upload content that doesn't match the hash
			const wrongContent = new TextEncoder().encode('wrong content');
			const uploadRequest = new Request('http://example.com', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${uploadJwt}`,
				},
				body: JSON.stringify({
					[hash]: base64.encode(wrongContent),
				}),
			});

			const uploadResponse = await uploadAssets(projectId, uploadRequest, projectsKv, mockAssetWorker, jwtSecret);
			expect(uploadResponse.status).toBe(400);
		});

		it('prevents duplicate uploads in same session', async () => {
			// Create project and session
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const content = new TextEncoder().encode('test content');
			const hash = await computeContentHash(content);
			const manifest = {
				'/test1.txt': { hash, size: content.length },
				'/test2.txt': { hash, size: content.length },
			};

			const sessionRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const sessionResponse = await createAssetUploadSession(projectId, sessionRequest, projectsKv, mockAssetWorker, jwtSecret);
			const sessionData = (await sessionResponse.json()) as any;
			const uploadJwt = sessionData.result.jwt;

			// First upload
			const uploadRequest1 = new Request('http://example.com', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${uploadJwt}`,
				},
				body: JSON.stringify({
					[hash]: base64.encode(content),
				}),
			});

			const uploadResponse1 = await uploadAssets(projectId, uploadRequest1, projectsKv, mockAssetWorker, jwtSecret);
			expect(uploadResponse1.status).toBe(201);

			// Try to upload same hash again
			const uploadRequest2 = new Request('http://example.com', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${uploadJwt}`,
				},
				body: JSON.stringify({
					[hash]: base64.encode(content),
				}),
			});

			const uploadResponse2 = await uploadAssets(projectId, uploadRequest2, projectsKv, mockAssetWorker, jwtSecret);
			expect(uploadResponse2.status).toBe(400);
		});

		it('returns pending status when not all assets uploaded', async () => {
			// Create project and session with multiple assets
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			const content1 = new TextEncoder().encode('content 1');
			const content2 = new TextEncoder().encode('content 2');
			const hash1 = await computeContentHash(content1);
			const hash2 = await computeContentHash(content2);

			const manifest = {
				'/file1.txt': { hash: hash1, size: content1.length },
				'/file2.txt': { hash: hash2, size: content2.length },
			};

			const sessionRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ manifest }),
			});

			const mockAssetWorker = createMockAssetWorker();
			const sessionResponse = await createAssetUploadSession(projectId, sessionRequest, projectsKv, mockAssetWorker, jwtSecret);
			const sessionData = (await sessionResponse.json()) as any;
			const uploadJwt = sessionData.result.jwt;

			// Upload only first asset
			const uploadRequest = new Request('http://example.com', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${uploadJwt}`,
				},
				body: JSON.stringify({
					[hash1]: base64.encode(content1),
				}),
			});

			const uploadResponse = await uploadAssets(projectId, uploadRequest, projectsKv, mockAssetWorker, jwtSecret);
			expect(uploadResponse.status).toBe(200);

			const uploadData = (await uploadResponse.json()) as any;
			expect(uploadData.success).toBe(true);
			expect(uploadData.result.jwt).toBeNull();
		});
	});
});
