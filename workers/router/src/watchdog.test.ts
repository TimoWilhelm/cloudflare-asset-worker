import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProjectMetadata } from './types';
import { runWatchdog } from './watchdog';
import { createMock } from '../../shared/test-utilities';

// Mock KV
const createMockKV = () => {
	const store = new Map<string, string>();
	return createMock<KVNamespace>({
		get: vi.fn(async (key: string, options?: { type?: string }) => {
			const value = store.get(key);
			if (!value) return;
			if (options && options.type === 'json') {
				return JSON.parse(value);
			}
			return value;
		}),
		put: vi.fn(async (key: string, value: string) => store.set(key, value)),
		delete: vi.fn(async (key: string) => store.delete(key)),
		list: vi.fn(async (options?: { prefix?: string }) => ({
			keys: [...store.keys()].filter((k) => !options?.prefix || k.startsWith(options.prefix)).map((name) => ({ name })),
			list_complete: true,
			cursor: undefined,
		})),
	});
};

describe('Watchdog Cleanup', () => {
	let mockProjectsKV: KVNamespace;
	let mockServerSideCodeKV: KVNamespace;
	let mockAssetWorker: { deleteProjectAssets: ReturnType<typeof vi.fn> };
	let environment: Env;

	beforeEach(() => {
		mockProjectsKV = createMockKV();
		mockServerSideCodeKV = createMockKV();
		mockAssetWorker = {
			deleteProjectAssets: vi.fn().mockResolvedValue({ deletedAssets: 0, deletedManifest: true }),
		};

		environment = createMock<Env>({
			KV_PROJECTS: mockProjectsKV,
			KV_SERVER_SIDE_CODE: mockServerSideCodeKV,
			ASSET_WORKER: mockAssetWorker,
		});
	});

	it('should keep READY projects', async () => {
		const project: ProjectMetadata = {
			id: 'ready-project',
			name: 'Ready Project',
			status: 'READY',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			hasServerSideCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/ready-project/metadata', JSON.stringify(project));

		await runWatchdog(environment);

		expect(mockProjectsKV.delete).not.toHaveBeenCalled();
	});

	it('should delete stale ERROR projects (>30m)', async () => {
		const staleDate = new Date(Date.now() - 31 * 60 * 1000).toISOString();
		const project: ProjectMetadata = {
			id: 'error-project',
			name: 'Error Project',
			status: 'ERROR',
			createdAt: staleDate,
			updatedAt: staleDate,
			hasServerSideCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/error-project/metadata', JSON.stringify(project));

		await runWatchdog(environment);

		expect(mockProjectsKV.delete).toHaveBeenCalledWith('project/error-project/metadata');
		expect(mockAssetWorker.deleteProjectAssets).toHaveBeenCalledWith('error-project');
	});

	it('should keep fresh ERROR projects (<30m)', async () => {
		const freshDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		const project: ProjectMetadata = {
			id: 'fresh-error',
			name: 'Fresh Error Project',
			status: 'ERROR',
			createdAt: freshDate,
			updatedAt: freshDate,
			hasServerSideCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/fresh-error/metadata', JSON.stringify(project));

		await runWatchdog(environment);

		expect(mockProjectsKV.delete).not.toHaveBeenCalled();
	});

	it('should delete stale PENDING projects (>30m)', async () => {
		const staleDate = new Date(Date.now() - 31 * 60 * 1000).toISOString();
		const project: ProjectMetadata = {
			id: 'stale-pending',
			name: 'Stale Pending Project',
			status: 'PENDING',
			createdAt: staleDate,
			updatedAt: staleDate,
			hasServerSideCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/stale-pending/metadata', JSON.stringify(project));

		await runWatchdog(environment);

		expect(mockProjectsKV.delete).toHaveBeenCalledWith('project/stale-pending/metadata');
	});

	it('should keep fresh PENDING projects (<30m)', async () => {
		const freshDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		const project: ProjectMetadata = {
			id: 'fresh-pending',
			name: 'Fresh Pending Project',
			status: 'PENDING',
			createdAt: freshDate,
			updatedAt: freshDate,
			hasServerSideCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/fresh-pending/metadata', JSON.stringify(project));

		await runWatchdog(environment);

		expect(mockProjectsKV.delete).not.toHaveBeenCalled();
	});

	it('should delete legacy/invalid projects (missing status)', async () => {
		const project = {
			id: 'legacy-project',
			name: 'Legacy Project',
			// status missing
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			hasServerSideCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/legacy-project/metadata', JSON.stringify(project));

		await runWatchdog(environment);

		expect(mockProjectsKV.delete).toHaveBeenCalledWith('project/legacy-project/metadata');
	});
});
