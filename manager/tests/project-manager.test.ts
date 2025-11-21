import {
	createProject,
	listProjects,
	getProjectInfo,
	deleteProject,
	getProject,
	getServerCodePrefix,
	getServerCodeKey,
} from '../src/project-manager';
import { env } from 'cloudflare:test';
import { ProjectMetadata } from '../src/types';
import type AssetApi from '../../api/src/worker';

interface ProjectResponse {
	success: boolean;
	project: {
		id: string;
		name: string;
		createdAt: string;
		updatedAt: string;
		hasServerCode: boolean;
		assetsCount: number;
	};
}

describe('project-manager', () => {
	let projectsKv: KVNamespace;
	let serverCodeKv: KVNamespace;

	beforeEach(async () => {
		projectsKv = env.PROJECTS_KV_NAMESPACE;
		serverCodeKv = env.SERVER_CODE_KV_NAMESPACE;

		// Clear KV namespaces before each test
		const projectKeys = await projectsKv.list({ prefix: 'project:' });
		for (const key of projectKeys.keys) {
			await projectsKv.delete(key.name);
		}

		const serverCodeKeys = await serverCodeKv.list();
		for (const key of serverCodeKeys.keys) {
			await serverCodeKv.delete(key.name);
		}
	});

	describe('createProject', () => {
		it('creates a new project with default name', async () => {
			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({}),
			});

			const response = await createProject(request, projectsKv);
			expect(response.status).toBe(201);

			const data = await response.json<ProjectResponse>();
			expect(data.success).toBe(true);
			expect(data.project).toBeDefined();
			expect(data.project.id).toBeDefined();
			expect(data.project.name).toMatch(/^Project /);
			expect(data.project.createdAt).toBeDefined();
			expect(data.project.updatedAt).toBeDefined();
			expect(data.project.hasServerCode).toBe(false);
			expect(data.project.assetsCount).toBe(0);
		});

		it('creates a new project with custom name', async () => {
			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'My Custom Project' }),
			});

			const response = await createProject(request, projectsKv);
			expect(response.status).toBe(201);

			const data = await response.json<ProjectResponse>();
			expect(data.success).toBe(true);
			expect(data.project.name).toBe('My Custom Project');
		});

		it('stores project in KV', async () => {
			const request = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});

			const response = await createProject(request, projectsKv);
			const data = await response.json<ProjectResponse>();
			const projectId = data.project.id;

			// Verify project is stored in KV
			const stored = await projectsKv.get<ProjectMetadata>(`project:${projectId}`, 'json');
			expect(stored).toBeDefined();
			expect(stored?.name).toBe('Test Project');
		});

		it('generates unique IDs for different projects', async () => {
			const request1 = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Project 1' }),
			});
			const request2 = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Project 2' }),
			});

			const response1 = await createProject(request1, projectsKv);
			const response2 = await createProject(request2, projectsKv);

			const data1 = await response1.json<ProjectResponse>();
			const data2 = await response2.json<ProjectResponse>();

			expect(data1.project.id).not.toBe(data2.project.id);
		});
	});

	describe('listProjects', () => {
		it('returns empty list when no projects exist', async () => {
			const response = await listProjects(projectsKv);
			expect(response.status).toBe(200);

			const data = await response.json<{ success: boolean; projects: ProjectMetadata[] }>();
			expect(data.success).toBe(true);
			expect(data.projects).toEqual([]);
		});

		it('returns all projects', async () => {
			// Create multiple projects
			const projects = ['Project A', 'Project B', 'Project C'];
			for (const name of projects) {
				const request = new Request('http://example.com', {
					method: 'POST',
					body: JSON.stringify({ name }),
				});
				await createProject(request, projectsKv);
			}

			const response = await listProjects(projectsKv);
			const data = await response.json<{ success: boolean; projects: ProjectMetadata[] }>();

			expect(data.success).toBe(true);
			expect(data.projects).toHaveLength(3);

			const projectNames = data.projects.map((p) => p.name);
			expect(projectNames).toContain('Project A');
			expect(projectNames).toContain('Project B');
			expect(projectNames).toContain('Project C');
		});

		it('lists valid projects only', async () => {
			// Create multiple valid projects
			for (const name of ['Project 1', 'Project 2']) {
				const request = new Request('http://example.com', {
					method: 'POST',
					body: JSON.stringify({ name }),
				});
				await createProject(request, projectsKv);
			}

			const response = await listProjects(projectsKv);
			const data = await response.json<{ success: boolean; projects: ProjectMetadata[] }>();

			expect(data.success).toBe(true);
			expect(data.projects).toHaveLength(2);
			expect(data.projects.every((p) => p !== null && p.name)).toBe(true);
		});
	});

	describe('getProjectInfo', () => {
		it('returns project information', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			// Get project info
			const response = await getProjectInfo(projectId, projectsKv);
			expect(response.status).toBe(200);

			const data = await response.json<ProjectResponse>();
			expect(data.success).toBe(true);
			expect(data.project.id).toBe(projectId);
			expect(data.project.name).toBe('Test Project');
		});

		it('returns 404 for non-existent project', async () => {
			const response = await getProjectInfo('non-existent-id', projectsKv);
			expect(response.status).toBe(404);
		});
	});

	describe('getProject', () => {
		it('retrieves project from KV', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			// Get project using getProject
			const project = await getProject(projectId, projectsKv);
			expect(project).toBeDefined();
			expect(project?.id).toBe(projectId);
			expect(project?.name).toBe('Test Project');
		});

		it('returns null for non-existent project', async () => {
			const project = await getProject('non-existent-id', projectsKv);
			expect(project).toBeNull();
		});
	});

	describe('deleteProject', () => {
		it('deletes a project', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			// Mock AssetApi
			const mockAssetWorker = {
				deleteProjectAssets: async () => ({ deletedAssets: 0, deletedManifest: false }),
			} as unknown as Service<AssetApi>;

			// Delete the project
			const response = await deleteProject(projectId, projectsKv, serverCodeKv, mockAssetWorker);
			expect(response.status).toBe(200);

			const data = await response.json<{ success: boolean; message: string }>();
			expect(data.success).toBe(true);
			expect(data.message).toBe('Project deleted');

			// Verify project is deleted from KV
			const project = await getProject(projectId, projectsKv);
			expect(project).toBeNull();
		});

		it('returns 404 for non-existent project', async () => {
			const mockAssetWorker = {
				deleteProjectAssets: async () => ({ deletedAssets: 0, deletedManifest: false }),
			} as unknown as Service<AssetApi>;

			const response = await deleteProject('non-existent-id', projectsKv, serverCodeKv, mockAssetWorker);
			expect(response.status).toBe(404);
		});

		it('deletes server code when project has it', async () => {
			// Create a project with server code flag
			const projectId = crypto.randomUUID();
			const project = {
				id: projectId,
				name: 'Test Project',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				hasServerCode: true,
				assetsCount: 0,
			};
			await projectsKv.put(`project:${projectId}`, JSON.stringify(project));

			// Add some server code modules
			const prefix = getServerCodePrefix(projectId);
			await serverCodeKv.put(`${prefix}module1`, 'content1');
			await serverCodeKv.put(`${prefix}module2`, 'content2');
			await serverCodeKv.put(`${prefix}MANIFEST`, 'manifest-content');

			const mockAssetWorker = {
				deleteProjectAssets: async () => ({ deletedAssets: 5, deletedManifest: true }),
			} as unknown as Service<AssetApi>;

			// Delete the project
			const response = await deleteProject(projectId, projectsKv, serverCodeKv, mockAssetWorker);
			const data = await response.json<{
				success: boolean;
				message?: string;
				deletedServerCode?: boolean;
				deletedServerCodeModules?: number;
				deletedAssets?: number;
				deletedManifest?: boolean;
			}>();

			expect(data.success).toBe(true);
			expect(data.deletedServerCode).toBe(true);
			expect(data.deletedServerCodeModules).toBe(3);

			// Verify server code is deleted
			const module1 = await serverCodeKv.get(`${prefix}module1`);
			expect(module1).toBeNull();
		});

		it('calls AssetApi to delete assets', async () => {
			// Create a project
			const createRequest = new Request('http://example.com', {
				method: 'POST',
				body: JSON.stringify({ name: 'Test Project' }),
			});
			const createResponse = await createProject(createRequest, projectsKv);
			const createData = await createResponse.json<ProjectResponse>();
			const projectId = createData.project.id;

			let calledWithProjectId: string | undefined;
			const mockAssetWorker = {
				deleteProjectAssets: async (id: string) => {
					calledWithProjectId = id;
					return { deletedAssets: 10, deletedManifest: true };
				},
			} as unknown as Service<AssetApi>;

			const response = await deleteProject(projectId, projectsKv, serverCodeKv, mockAssetWorker);
			const data = await response.json<{
				success: boolean;
				message?: string;
				deletedAssets?: number;
				deletedManifest?: boolean;
			}>();

			expect(calledWithProjectId).toBe(projectId);
			expect(data.deletedAssets).toBe(10);
			expect(data.deletedManifest).toBe(true);
		});
	});

	describe('utility functions', () => {
		describe('getServerCodePrefix', () => {
			it('returns correct prefix', () => {
				expect(getServerCodePrefix('project-123')).toBe('project-123:');
				expect(getServerCodePrefix('abc')).toBe('abc:');
			});
		});

		describe('getServerCodeKey', () => {
			it('returns namespaced key', () => {
				expect(getServerCodeKey('project-123', 'module.js')).toBe('project-123:module.js');
				expect(getServerCodeKey('abc', 'MANIFEST')).toBe('abc:MANIFEST');
			});

			it('handles complex keys', () => {
				expect(getServerCodeKey('proj-1', 'path/to/module.js')).toBe('proj-1:path/to/module.js');
			});
		});
	});
});
