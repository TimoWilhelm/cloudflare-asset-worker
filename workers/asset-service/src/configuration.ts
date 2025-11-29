// User-provided configuration (lineNumber not included - auto-generated from order)
export interface AssetConfigInput {
	html_handling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none';
	not_found_handling?: 'single-page-application' | '404-page' | 'none';
	redirects?: {
		staticRules: Record<string, { status: number; to: string }>;
		rules: Record<string, { status: number; to: string }>;
	};
	headers?: {
		rules: Record<string, { set?: Record<string, string>; unset?: string[] }>;
	};
	has_static_routing?: boolean;
	debug?: boolean;
}

// Internal configuration (lineNumber is required for runtime)
export interface AssetConfig {
	html_handling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none';
	not_found_handling?: 'single-page-application' | '404-page' | 'none';
	redirects?: {
		staticRules: Record<string, { status: number; to: string; lineNumber: number }>;
		rules: Record<string, { status: number; to: string }>;
	};
	headers?: {
		rules: Record<string, { set?: Record<string, string>; unset?: string[] }>;
	};
	has_static_routing?: boolean;
	debug?: boolean;
}

export const normalizeConfiguration = (configuration?: AssetConfigInput): Required<AssetConfig> => {
	// Auto-generate lineNumber from rule order
	const staticRules: Record<string, { status: number; to: string; lineNumber: number }> = {};
	if (configuration?.redirects?.staticRules) {
		let lineNumber = 1;
		for (const [path, rule] of Object.entries(configuration.redirects.staticRules)) {
			staticRules[path] = {
				status: rule.status,
				to: rule.to,
				lineNumber: lineNumber++,
			};
		}
	}

	return {
		html_handling: configuration?.html_handling ?? 'auto-trailing-slash',
		not_found_handling: configuration?.not_found_handling ?? 'none',
		redirects: {
			staticRules,
			rules: configuration?.redirects?.rules ?? {},
		},
		headers: configuration?.headers ?? {
			rules: {},
		},
		has_static_routing: configuration?.has_static_routing ?? false,
		debug: configuration?.debug ?? false,
	};
};
