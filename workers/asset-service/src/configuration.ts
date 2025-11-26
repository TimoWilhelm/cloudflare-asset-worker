export interface AssetConfig {
	html_handling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none';
	not_found_handling?: 'single-page-application' | '404-page' | 'none';
	redirects?: {
		version: number;
		staticRules: Record<string, { status: number; to: string; lineNumber: number }>;
		rules: Record<string, { status: number; to: string }>;
	};
	headers?: {
		version: number;
		rules: Record<string, { set?: Record<string, string>; unset?: string[] }>;
	};
	has_static_routing?: boolean;
	debug?: boolean;
}

export const normalizeConfiguration = (configuration?: AssetConfig): Required<AssetConfig> => {
	return {
		html_handling: configuration?.html_handling ?? 'auto-trailing-slash',
		not_found_handling: configuration?.not_found_handling ?? 'none',
		redirects: configuration?.redirects ?? {
			version: 1,
			staticRules: {},
			rules: {},
		},
		headers: configuration?.headers ?? {
			version: 2,
			rules: {},
		},
		has_static_routing: configuration?.has_static_routing ?? false,
		debug: configuration?.debug ?? false,
	};
};
