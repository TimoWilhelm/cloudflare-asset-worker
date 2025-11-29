// Base configuration properties shared by input and internal config
interface AssetConfigBase {
	html_handling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none';
	not_found_handling?: 'single-page-application' | '404-page' | 'none';
	headers?: {
		rules: Record<string, { set?: Record<string, string>; unset?: string[] }>;
	};
	has_static_routing?: boolean;
	debug?: boolean;
}

// User-provided configuration (lineNumber not included - auto-generated from order)
export interface AssetConfigInput extends AssetConfigBase {
	redirects?: {
		static: Record<string, { status: number; to: string }>;
		dynamic: Record<string, { status: number; to: string }>;
	};
}

// Internal configuration (lineNumber is required for runtime)
export interface AssetConfig extends AssetConfigBase {
	redirects?: {
		static: Record<string, { status: number; to: string; lineNumber: number }>;
		dynamic: Record<string, { status: number; to: string }>;
	};
}

export const normalizeConfiguration = (configuration?: AssetConfigInput): Required<AssetConfig> => {
	// Auto-generate lineNumber from rule order
	const staticRedirects: Record<string, { status: number; to: string; lineNumber: number }> = {};
	if (configuration?.redirects?.static) {
		let lineNumber = 1;
		for (const [path, rule] of Object.entries(configuration.redirects.static)) {
			staticRedirects[path] = {
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
			static: staticRedirects,
			dynamic: configuration?.redirects?.dynamic ?? {},
		},
		headers: configuration?.headers ?? {
			rules: {},
		},
		has_static_routing: configuration?.has_static_routing ?? false,
		debug: configuration?.debug ?? false,
	};
};
