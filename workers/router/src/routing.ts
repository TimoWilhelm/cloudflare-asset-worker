import { minimatch } from 'minimatch';

/**
 * Checks if a pathname matches all given glob patterns.
 * Uses minimatch's native negation support - a pattern like "!assets/**" returns
 * true when the path does NOT match "assets/**".
 *
 * All patterns must match (AND logic) to return true.
 * Example: ["**", "!assets/**"] means "match everything except assets"
 *
 * @param pathname - The pathname to check
 * @param patterns - Array of glob patterns (supports ! prefix for negation via minimatch)
 * @returns True if pathname matches all patterns
 */
export function matchesGlobPatterns(pathname: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (!minimatch(pathname, pattern)) {
			return false;
		}
	}
	return patterns.length > 0;
}

/**
 * Determines if the worker should run before checking static assets.
 *
 * @param config - The run_worker_first setting: boolean, glob patterns array, or undefined
 * @param pathname - The request pathname to evaluate
 * @returns True if the worker should handle the request first, false otherwise
 */
export function shouldRunWorkerFirst(config: boolean | string[] | undefined, pathname: string): boolean {
	if (config === undefined || config === false) {
		return false;
	}

	if (config === true) {
		return true;
	}

	// If config is string[], check if pathname matches any pattern
	return matchesGlobPatterns(pathname, config);
}

/**
 * Extracts the project ID from a URL using subdomain or path-based routing.
 *
 * @param url - The URL to extract the project ID from
 * @returns Object containing the project ID (or null) and whether path-based routing was used
 */
export function extractProjectId(url: URL): { projectId: string | null; isPathBased: boolean } {
	// Check for path-based routing: /__project/project-id/...
	if (url.pathname.startsWith('/__project/')) {
		const parts = url.pathname.split('/');
		return {
			projectId: parts[2] || null,
			isPathBased: true,
		};
	}

	// Check for subdomain-based routing: project-id.domain.com
	const subdomain = url.hostname.split('.')[0];
	if (subdomain && subdomain !== 'www' && !url.hostname.startsWith('localhost')) {
		return {
			projectId: subdomain,
			isPathBased: false,
		};
	}

	return { projectId: null, isPathBased: false };
}

/**
 * Rewrites a request URL to strip the path-based project prefix.
 *
 * @param request - The original HTTP request
 * @param projectId - The project ID to strip from the path
 * @returns A new Request with the project prefix removed from the pathname
 */
export function rewriteRequestUrl(request: Request, projectId: string): Request {
	const url = new URL(request.url);
	const prefix = `/__project/${projectId}`;

	if (url.pathname.startsWith(prefix)) {
		// Strip the prefix and keep the rest
		const newPathname = url.pathname.slice(prefix.length) || '/';
		url.pathname = newPathname;
	}

	return new Request(url.toString(), {
		method: request.method,
		headers: request.headers,
		body: request.body,
	});
}
