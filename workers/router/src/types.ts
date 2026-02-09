import { AssetConfigInput } from '../../asset-service/src/configuration';
import AssetWorker from '../../asset-service/src/worker';

export interface RouterEnvironment extends Env {
	ASSET_WORKER: Service<AssetWorker>;
}

export interface ProjectMetadata {
	id: string;
	name: string;
	status: 'PENDING' | 'READY' | 'ERROR';
	createdAt: string;
	updatedAt: string;
	hasServer: boolean;
	assetsCount: number;
	config?: AssetConfigInput;
	run_worker_first?: boolean | string[];
}

export type ModuleType = 'js' | 'cjs' | 'py' | 'text' | 'data' | 'json' | 'wasm';

export interface ServerSideCodeManifest {
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
	server?: {
		entrypoint: string;
		// Modules are base64-encoded with optional type specification
		// Can be: string (base64) or { content: string, type: ModuleType }
		modules: Record<string, string | { content: string; type: ModuleType }>;
		compatibilityDate?: string;
	};
	config?: AssetConfigInput;
	run_worker_first?: boolean | string[];
	env?: Record<string, string>;
}

export interface CompletionJwtPayload {
	sessionId: string;
	projectId: string;
	phase: 'complete';
	manifest: Record<string, { hash: string; size: number }>;
}

export interface UploadJwtPayload {
	sessionId: string;
	projectId: string;
	phase: 'upload';
}

export type JwtPayload = CompletionJwtPayload | UploadJwtPayload;
