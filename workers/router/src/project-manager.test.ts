import { env } from 'cloudflare:test';

import {
	createProject,
	listProjects,
	getProjectInfo,
	deleteProject,
	getProject,
	getServerSideCodePrefix,
	getServerSideCodeKey,
} from './project-manager';
import { ProjectMetadata } from './types';
import { createMock } from '../../shared/test-utilities';

import type AssetApi from '../../asset-service/src/worker';

interface ProjectResponse {
	success: boolean;
	project: {
		id: string;
		name: string;
		createdAt: string;
		updatedAt: string;
		hasServerSideCode: boolean;
		assetsCount: number;
	};
}

interface ListProjectsResponse {
	success: boolean;
	projects: ProjectMetadata[];
	pagination: {
		nextCursor: string | undefined;
		hasMore: boolean;
		limit: number;
	};
}

describe('project-manager', () => {
	let projectsKv: KVNamespace;
	let serverSideCodeKv: KVNamespace;

	beforeEach(async () => {
		projectsKv = env.KV_PROJECTS;
		serverSideCodeKv = env.KV_SERVER_SIDE_CODE;

		// Clear KV namespaces before each test
		const projectKeys = await projectsKv.list({ prefix: 'project/' });
		for (const key of projectKeys.keys) {
			await projectsKv.delete(key.name);
		}

		const serverSideCodeKeys = await serverSideCodeKv.list();
		for (const key of serverSideCodeKeys.keys) {
			await serverSideCodeKv.delete(key.name);
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
			expect(data.project.hasServerSideCode).toBe(false);
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
			const stored = await projectsKv.get<ProjectMetadata>(`project/${projectId}/metadata`, 'json');
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

			const data = await response.json<ListProjectsResponse>();
			expect(data.success).toBe(true);
			expect(data.projects).toEqual([]);
			expect(data.pagination).toBeDefined();
			expect(data.pagination.hasMore).toBe(false);
			expect(data.pagination.nextCursor).toBeUndefined();
		});

		it('returns all projects with pagination metadata', async () => {
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
			const data = await response.json<ListProjectsResponse>();

			expect(data.success).toBe(true);
			expect(data.projects).toHaveLength(3);
			expect(data.pagination.limit).toBe(100);

			const projectNames = data.projects.map((p) => p.name);
			expect(projectNames).toContain('Project A');
			expect(projectNames).toContain('Project B');
			expect(projectNames).toContain('Project C');
		});

		it('respects custom limit parameter', async () => {
			// Create 5 projects
			for (let index = 1; index <= 5; index++) {
				const request = new Request('http://example.com', {
					method: 'POST',
					body: JSON.stringify({ name: `Project ${index}` }),
				});
				await createProject(request, projectsKv);
			}

			const response = await listProjects(projectsKv, { limit: 2 });
			const data = await response.json<ListProjectsResponse>();

			expect(data.success).toBe(true);
			expect(data.projects).toHaveLength(2);
			expect(data.pagination.limit).toBe(2);
			expect(data.pagination.hasMore).toBe(true);
			expect(data.pagination.nextCursor).toBeDefined();
		});

		it('supports cursor-based pagination', async () => {
			// Create 5 projects
			for (let index = 1; index <= 5; index++) {
				const request = new Request('http://example.com', {
					method: 'POST',
					body: JSON.stringify({ name: `Project ${index}` }),
				});
				await createProject(request, projectsKv);
			}

			// First page
			const response1 = await listProjects(projectsKv, { limit: 2 });
			const data1 = await response1.json<ListProjectsResponse>();

			expect(data1.projects).toHaveLength(2);
			expect(data1.pagination.hasMore).toBe(true);
			expect(data1.pagination.nextCursor).toBeDefined();

			// Second page using cursor
			const response2 = await listProjects(projectsKv, { limit: 2, cursor: data1.pagination.nextCursor! });
			const data2 = await response2.json<ListProjectsResponse>();

			expect(data2.projects).toHaveLength(2);
			expect(data2.pagination.hasMore).toBe(true);

			// Third page (last)
			const response3 = await listProjects(projectsKv, { limit: 2, cursor: data2.pagination.nextCursor! });
			const data3 = await response3.json<ListProjectsResponse>();

			expect(data3.projects).toHaveLength(1);
			expect(data3.pagination.hasMore).toBe(false);
			expect(data3.pagination.nextCursor).toBeUndefined();

			// All projects should be unique across pages
			const allProjectIds = [...data1.projects.map((p) => p.id), ...data2.projects.map((p) => p.id), ...data3.projects.map((p) => p.id)];
			const uniqueIds = new Set(allProjectIds);
			expect(uniqueIds.size).toBe(5);
		});

		it('uses provided limit directly (validation done at API layer)', async () => {
			// listProjects trusts the API layer to validate, so it uses the limit as-is
			const response = await listProjects(projectsKv, { limit: 10 });
			const data = await response.json<ListProjectsResponse>();

			expect(data.pagination.limit).toBe(10);
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
			const data = await response.json<ListProjectsResponse>();

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
			const mockAssetWorker = createMock<Service<AssetApi>>({
				deleteProjectAssets: async () => ({ deletedAssets: 0, deletedManifest: false }),
			});

			// Delete the project
			const response = await deleteProject(projectId, projectsKv, serverSideCodeKv, mockAssetWorker);
			expect(response.status).toBe(200);

			const data = await response.json<{ success: boolean; message: string }>();
			expect(data.success).toBe(true);
			expect(data.message).toBe('Project deleted');

			// Verify project is deleted from KV
			const project = await getProject(projectId, projectsKv);
			expect(project).toBeNull();
		});

		it('returns 404 for non-existent project', async () => {
			const mockAssetWorker = createMock<Service<AssetApi>>({
				deleteProjectAssets: async () => ({ deletedAssets: 0, deletedManifest: false }),
			});

			const response = await deleteProject('non-existent-id', projectsKv, serverSideCodeKv, mockAssetWorker);
			expect(response.status).toBe(404);
		});

		it('deletes server-side code when project has it', async () => {
			// Create a project with server-side code flag
			const projectId = crypto.randomUUID();
			const project = {
				id: projectId,
				name: 'Test Project',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				hasServerSideCode: true,
				assetsCount: 0,
			};
			await projectsKv.put(`project/${projectId}/metadata`, JSON.stringify(project));

			// Add some server-side code modules using the real key format
			await serverSideCodeKv.put(getServerSideCodeKey(projectId, 'hash1'), 'content1');
			await serverSideCodeKv.put(getServerSideCodeKey(projectId, 'hash2'), 'content2');
			await serverSideCodeKv.put(getServerSideCodeKey(projectId, 'MANIFEST'), 'manifest-content');

			const mockAssetWorker = createMock<Service<AssetApi>>({
				deleteProjectAssets: async () => ({ deletedAssets: 5, deletedManifest: true }),
			});

			// Delete the project
			const response = await deleteProject(projectId, projectsKv, serverSideCodeKv, mockAssetWorker);
			const data = await response.json<{
				success: boolean;
				message?: string;
				deletedServerSideCode?: boolean;
				deletedServerSideCodeModules?: number;
				deletedAssets?: number;
				deletedManifest?: boolean;
			}>();

			expect(data.success).toBe(true);
			expect(data.deletedServerSideCode).toBe(true);
			expect(data.deletedServerSideCodeModules).toBe(3);

			// Verify server-side code is deleted
			const module1 = await serverSideCodeKv.get(getServerSideCodeKey(projectId, 'hash1'));
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
			const mockAssetWorker = createMock<Service<AssetApi>>({
				deleteProjectAssets: async (id: string) => {
					calledWithProjectId = id;
					return { deletedAssets: 10, deletedManifest: true };
				},
			});

			const response = await deleteProject(projectId, projectsKv, serverSideCodeKv, mockAssetWorker);
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
		describe('getServerSideCodePrefix', () => {
			it('returns correct prefix', () => {
				expect(getServerSideCodePrefix('project-123')).toBe('project/project-123/module/');
				expect(getServerSideCodePrefix('abc')).toBe('project/abc/module/');
			});
		});

		describe('getServerSideCodeKey', () => {
			it('returns namespaced key', () => {
				expect(getServerSideCodeKey('project-123', 'module.js')).toBe('project/project-123/module/module.js');
				expect(getServerSideCodeKey('abc', 'MANIFEST')).toBe('project/abc/module/MANIFEST');
			});

			it('handles complex keys', () => {
				expect(getServerSideCodeKey('proj-1', 'path/to/module.js')).toBe('project/proj-1/module/path/to/module.js');
			});
		});
	});
});
