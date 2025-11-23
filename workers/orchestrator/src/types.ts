import type { AssetConfig } from '../../asset-service/src/configuration';

export interface ProjectMetadata {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	hasServerCode: boolean;
	assetsCount: number;
	config?: AssetConfig;
	run_worker_first?: boolean | string[];
}

export type ModuleType = 'js' | 'cjs' | 'py' | 'text' | 'data' | 'json';

export interface ServerCodeManifest {
	entrypoint: string;
	// Map of module path to { hash, type }
	modules: Record<string, { hash: string; type: ModuleType }>;
	compatibilityDate?: string;
	env?: Record<string, string>;
}

export interface UploadSession {
	sessionId: string;
	projectId: string;
	manifest: Record<string, { hash: string; size: number }>;
	buckets: string[][];
	uploadedHashes: Set<string>;
	createdAt: number;
	completionToken?: string;
}

export interface AssetManifestRequest {
	manifest: Record<string, { hash: string; size: number }>;
}

export interface DeploymentPayload {
	projectName?: string;
	completionJwt?: string;
	serverCode?: {
		entrypoint: string;
		// Modules are base64-encoded with optional type specification
		// Can be: string (base64) or { content: string, type: ModuleType }
		modules: Record<string, string | { content: string; type: ModuleType }>;
		compatibilityDate?: string;
	};
	config?: AssetConfig;
	run_worker_first?: boolean | string[];
	env?: Record<string, string>;
}
