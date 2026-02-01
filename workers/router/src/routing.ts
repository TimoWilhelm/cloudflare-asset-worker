import { minimatch } from 'minimatch';

/**
 * Checks if a pathname matches the given glob patterns.
 *
 * The array supports glob patterns with * for deep matching and negative patterns
 * with ! prefix. Negative patterns have precedence over non-negative patterns.
 *
 * Returns true if:
 * - At least one non-negative pattern matches the pathname, AND
 * - None of the negative patterns match the pathname
 *
 * The order in which the patterns are listed is not significant.
 *
 * @param pathname - The pathname to check
 * @param patterns - Array of glob patterns (supports ! prefix for negation)
 * @returns True if pathname matches according to the rules above
 *
 * @example
 * // Match all paths under /api
 * matchesGlobPatterns('/api/users', ['/api/**']) // true
 *
 * @example
 * // Match all paths except those under /api/internal
 * matchesGlobPatterns('/api/users', ['/api/**', '!/api/internal/**']) // true
 * matchesGlobPatterns('/api/internal/secret', ['/api/**', '!/api/internal/**']) // false
 */
export function matchesGlobPatterns(pathname: string, patterns: string[]): boolean {
	// Separate negative and positive patterns
	const negativePatterns: string[] = [];
	const positivePatterns: string[] = [];

	for (const pattern of patterns) {
		if (pattern.startsWith('!')) {
			// Store the pattern without the ! prefix for matching
			negativePatterns.push(pattern.slice(1));
		} else {
			positivePatterns.push(pattern);
		}
	}

	// Check if any negative pattern matches (these have precedence)
	for (const pattern of negativePatterns) {
		if (minimatch(pathname, pattern)) {
			return false;
		}
	}

	// Check if any positive pattern matches
	for (const pattern of positivePatterns) {
		if (minimatch(pathname, pattern)) {
			return true;
		}
	}

	return false;
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
