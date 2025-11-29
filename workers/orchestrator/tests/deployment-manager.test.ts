import { deployProject } from '../src/deployment-manager';
import { createProject } from '../src/project-manager';
import { generateJWT } from '../src/jwt';
import { env } from 'cloudflare:test';

describe('deployment-manager', () => {
	let projectsKv: KVNamespace;
	let serverCodeKv: KVNamespace;
	const jwtSecret = 'test-secret-key';

	beforeEach(async () => {
		projectsKv = env.KV_PROJECTS;
		serverCodeKv = env.KV_SERVER_CODE;

		// Clear KV namespaces before each test
		const projectKeys = await projectsKv.list();
		for (const key of projectKeys.keys) {
			await projectsKv.delete(key.name);
		}

		const serverKeys = await serverCodeKv.list();
		for (const key of serverKeys.keys) {
			await serverCodeKv.delete(key.name);
		}
	});

	const mockAssetWorker = {
		uploadManifest: async () => [],
	} as any;

	describe('environment variables validation', () => {
		it('should accept deployments with 64 or fewer environment variables', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			// Create 64 environment variables (at the limit)
			const env: Record<string, string> = {};
			for (let i = 1; i <= 64; i++) {
				env[`VAR_${i}`] = `value_${i}`;
			}

			// Deploy with 64 env vars
			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
					env,
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.success).toBe(true);
		});

		it('should reject deployments with more than 64 environment variables', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			// Create 65 environment variables (exceeds limit)
			const env: Record<string, string> = {};
			for (let i = 1; i <= 65; i++) {
				env[`VAR_${i}`] = `value_${i}`;
			}

			// Deploy with 65 env vars
			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
					env,
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(400);
			const errorText = await response.text();
			expect(errorText).toContain('Too many environment variables');
			expect(errorText).toContain('65');
			expect(errorText).toContain('Maximum allowed is 64');
		});

		it('should accept deployments with no environment variables', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			// Deploy without env vars
			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.success).toBe(true);
		});

		it('should accept environment variables up to 5 KB in size', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			// Create an env var with exactly 5 KB of data (5120 bytes)
			const largeValue = 'x'.repeat(5120);

			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
					env: {
						LARGE_VAR: largeValue,
					},
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.success).toBe(true);
		});

		it('should reject environment variables exceeding 5 KB in size', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = (await createResponse.json()) as any;
			const projectId = createData.project.id;

			// Create an env var with more than 5 KB of data (5121 bytes)
			const tooLargeValue = 'x'.repeat(5121);

			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
					env: {
						TOO_LARGE_VAR: tooLargeValue,
					},
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(400);
			const errorText = await response.text();
			expect(errorText).toContain('TOO_LARGE_VAR');
			expect(errorText).toContain('too large');
			expect(errorText).toContain('5121 bytes');
		});
	});
});
