import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWatchdog } from './watchdog';
import { ProjectMetadata } from './types';

// Mock KV
const createMockKV = () => {
	const store = new Map<string, string>();
	return {
		get: vi.fn(async (key, options) => {
			const value = store.get(key);
			if (!value) return null;
			if (options && options.type === 'json') {
				return JSON.parse(value);
			}
			return value;
		}),
		put: vi.fn(async (key, value) => store.set(key, value)),
		delete: vi.fn(async (key) => store.delete(key)),
		list: vi.fn(async (opts?: { prefix?: string }) => ({
			keys: Array.from(store.keys())
				.filter((k) => !opts?.prefix || k.startsWith(opts.prefix))
				.map((name) => ({ name })),
			list_complete: true,
			cursor: null,
		})),
	} as unknown as KVNamespace;
};

describe('Watchdog Cleanup', () => {
	let mockProjectsKV: any;
	let mockServerCodeKV: any;
	let mockAssetWorker: any;
	let env: any;

	beforeEach(() => {
		mockProjectsKV = createMockKV();
		mockServerCodeKV = createMockKV();
		mockAssetWorker = {
			deleteProjectAssets: vi.fn().mockResolvedValue({ deletedAssets: 0, deletedManifest: true }),
		};

		env = {
			KV_PROJECTS: mockProjectsKV,
			KV_SERVER_CODE: mockServerCodeKV,
			ASSET_WORKER: mockAssetWorker,
		};
	});

	it('should keep READY projects', async () => {
		const project: ProjectMetadata = {
			id: 'ready-project',
			name: 'Ready Project',
			status: 'READY',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			hasServerCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/ready-project/metadata', JSON.stringify(project));

		await runWatchdog(env);

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
			hasServerCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/error-project/metadata', JSON.stringify(project));

		await runWatchdog(env);

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
			hasServerCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/fresh-error/metadata', JSON.stringify(project));

		await runWatchdog(env);

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
			hasServerCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/stale-pending/metadata', JSON.stringify(project));

		await runWatchdog(env);

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
			hasServerCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/fresh-pending/metadata', JSON.stringify(project));

		await runWatchdog(env);

		expect(mockProjectsKV.delete).not.toHaveBeenCalled();
	});

	it('should delete legacy/invalid projects (missing status)', async () => {
		const project = {
			id: 'legacy-project',
			name: 'Legacy Project',
			// status missing
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			hasServerCode: false,
			assetsCount: 0,
		};
		await mockProjectsKV.put('project/legacy-project/metadata', JSON.stringify(project));

		await runWatchdog(env);

		expect(mockProjectsKV.delete).toHaveBeenCalledWith('project/legacy-project/metadata');
	});
});
