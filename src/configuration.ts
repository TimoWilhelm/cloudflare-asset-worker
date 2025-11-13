import type { AssetConfig } from "./lib/types";

export const normalizeConfiguration = (
	configuration?: AssetConfig
): Required<AssetConfig> => {
	return {
		html_handling: configuration?.html_handling ?? "auto-trailing-slash",
		not_found_handling: configuration?.not_found_handling ?? "none",
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
		account_id: configuration?.account_id ?? -1,
		script_id: configuration?.script_id ?? -1,
		debug: configuration?.debug ?? false,
	};
};
