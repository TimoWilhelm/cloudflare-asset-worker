import { env } from 'cloudflare:test';

import { deployProject } from './deployment-manager';
import { createProject } from './project-manager';
import { createMock } from '../../shared/test-utilities';

import type AssetWorker from '../../asset-service/src/worker';

interface ProjectResponse {
	success: boolean;
	project: { id: string };
}

interface DeployResponse {
	success: boolean;
}

describe('deployment-manager', () => {
	let projectsKv: KVNamespace;
	let serverSideCodeKv: KVNamespace;
	const jwtSecret = 'test-secret-key';

	beforeEach(async () => {
		projectsKv = env.KV_PROJECTS;
		serverSideCodeKv = env.KV_SERVER_SIDE_CODE;

		// Clear KV namespaces before each test
		const projectKeys = await projectsKv.list();
		for (const key of projectKeys.keys) {
			await projectsKv.delete(key.name);
		}

		const serverKeys = await serverSideCodeKv.list();
		for (const key of serverKeys.keys) {
			await serverSideCodeKv.delete(key.name);
		}
	});

	const mockAssetWorker = createMock<Service<AssetWorker>>({
		uploadManifest: async () => [],
	});

	describe('environment variables validation', () => {
		it('should accept deployments with 64 or fewer environment variables', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			// Create 64 environment variables (at the limit)
			const environment: Record<string, string> = {};
			for (let index = 1; index <= 64; index++) {
				environment[`VAR_${index}`] = `value_${index}`;
			}

			// Deploy with 64 env vars
			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
					env: environment,
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverSideCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = await response.json<DeployResponse>();
			expect(data.success).toBe(true);
		});

		it('should reject deployments with more than 64 environment variables', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			// Create 65 environment variables (exceeds limit)
			const environment: Record<string, string> = {};
			for (let index = 1; index <= 65; index++) {
				environment[`VAR_${index}`] = `value_${index}`;
			}

			// Deploy with 65 env vars
			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
					env: environment,
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverSideCodeKv, mockAssetWorker, jwtSecret);

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
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			// Deploy without env vars
			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverSideCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = await response.json<DeployResponse>();
			expect(data.success).toBe(true);
		});

		it('should accept environment variables up to 5 KB in size', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			// Create an env var with exactly 5 KB of data (5000 bytes)
			const largeValue = 'x'.repeat(5000);

			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
					env: {
						LARGE_VAR: largeValue,
					},
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverSideCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(200);
			const data = await response.json<DeployResponse>();
			expect(data.success).toBe(true);
		});

		it('should reject environment variables exceeding 5 KB in size', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const createResponse = await createProject(createRequest, projectsKv);
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			// Create an env var with more than 5 KB of data (5001 bytes)
			const tooLargeValue = 'x'.repeat(5001);

			const deployRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({
					projectName: 'Test Project',
					env: {
						TOO_LARGE_VAR: tooLargeValue,
					},
				}),
			});

			const response = await deployProject(projectId, deployRequest, projectsKv, serverSideCodeKv, mockAssetWorker, jwtSecret);

			expect(response.status).toBe(400);
			const errorText = await response.text();
			expect(errorText).toContain('TOO_LARGE_VAR');
			expect(errorText).toContain('too large');
			expect(errorText).toContain('5.00 KB');
		});
	});
});
