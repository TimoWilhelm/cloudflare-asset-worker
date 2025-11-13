// Asset configuration types
export interface AssetConfig {
	html_handling?: "auto-trailing-slash" | "force-trailing-slash" | "drop-trailing-slash" | "none";
	not_found_handling?: "single-page-application" | "404-page" | "none";
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
	account_id?: number;
	script_id?: number;
	debug?: boolean;
}
