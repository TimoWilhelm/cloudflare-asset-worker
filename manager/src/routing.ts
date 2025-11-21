import { minimatch } from 'minimatch';

/**
 * Check if a pathname matches glob patterns using minimatch
 * @param pathname - The pathname to check
 * @param patterns - Array of glob patterns to match against
 * @returns True if pathname matches any pattern
 */
export function matchesGlobPatterns(pathname: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (minimatch(pathname, pattern)) {
			return true;
		}
	}
	return false;
}

/**
 * Determine if worker should run first based on config and pathname
 * @param config - The run_worker_first configuration
 * @param pathname - The request pathname
 * @returns True if worker should run first
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
 * Extract project ID from subdomain or path
 * Returns both the project ID and whether path-based routing is used
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
 * Rewrite request URL to strip path-based project prefix
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
