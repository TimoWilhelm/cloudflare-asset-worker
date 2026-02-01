/**
 * Rewrites HTML responses to fix relative paths for path-based routing.
 *
 * When using /__project/projectId/ routing in development, relative paths like
 * /assets/main.js resolve to /assets/main.js instead of /__project/projectId/assets/main.js.
 * This rewriter fixes that by prepending the project prefix to absolute paths.
 */

const PATH_ATTRIBUTES: Record<string, string[]> = {
	script: ['src'],
	link: ['href'],
	a: ['href'],
	img: ['src', 'srcset'],
	form: ['action'],
	source: ['src', 'srcset'],
	video: ['src', 'poster'],
	audio: ['src'],
	iframe: ['src'],
	object: ['data'],
	embed: ['src'],
	use: ['href', 'xlink:href'],
	image: ['href', 'xlink:href'],
};

/**
 * Creates an HTMLRewriter handler that rewrites absolute paths to include the project prefix.
 */
class PathRewriteHandler implements HTMLRewriterElementContentHandlers {
	private projectId: string;
	private attributes: string[];

	constructor(projectId: string, attributes: string[]) {
		this.projectId = projectId;
		this.attributes = attributes;
	}

	element(element: Element): void | Promise<void> {
		const prefix = `/__project/${this.projectId}`;

		for (const attr of this.attributes) {
			const value = element.getAttribute(attr);
			if (value === null || value === undefined) continue;

			// Handle srcset which can have multiple URLs
			if (attr === 'srcset') {
				const rewritten = this.rewriteSrcset(value, prefix);
				if (rewritten !== value) {
					element.setAttribute(attr, rewritten);
				}
				continue;
			}

			// Only rewrite root-relative paths (starting with /)
			// Don't rewrite: protocol URLs (http:, https:, data:, javascript:, etc)
			// Don't rewrite: relative paths (./foo, foo/bar)
			// Don't rewrite: fragment-only (#anchor)
			// Don't rewrite: already prefixed paths
			if (this.shouldRewritePath(value, prefix)) {
				element.setAttribute(attr, prefix + value);
			}
		}
	}

	private shouldRewritePath(value: string, prefix: string): boolean {
		// Must start with / (root-relative path)
		if (!value.startsWith('/')) return false;
		// Already has the project prefix
		if (value.startsWith(prefix)) return false;
		// Protocol-relative URLs (//example.com)
		if (value.startsWith('//')) return false;
		return true;
	}

	private rewriteSrcset(srcset: string, prefix: string): string {
		// srcset format: "url1 1x, url2 2x" or "url1 300w, url2 600w"
		return srcset
			.split(',')
			.map((entry) => {
				const parts = entry.trim().split(/\s+/);
				const firstPart = parts[0];
				if (firstPart && this.shouldRewritePath(firstPart, prefix)) {
					parts[0] = prefix + firstPart;
				}
				return parts.join(' ');
			})
			.join(', ');
	}
}

/**
 * Handlers text content in script tags to rewrite paths in inline scripts.
 * TanStack Start injects inline scripts that reference assets, e.g. import('/assets/...')
 */
class ScriptTextHandler implements HTMLRewriterElementContentHandlers {
	private projectId: string;
	private buffer: string = '';

	constructor(projectId: string) {
		this.projectId = projectId;
	}

	text(text: Text): void | Promise<void> {
		this.buffer += text.text;

		if (text.lastInTextNode) {
			const content = this.buffer;
			const prefix = `/__project/${this.projectId}`;
			// Rewrite absolute paths (/assets/...) in import() calls
			const replaced = content.replace(/(["'])((?:\/|\.\/|\/\.\/)?assets\/.*?)\1/g, (match, quote, path) => {
				if (path.startsWith('/')) {
					return `${quote}${prefix}${path}${quote}`;
				}
				return match;
			});

			text.replace(replaced, { html: true });
			this.buffer = '';
		} else {
			text.remove();
		}
	}
}

/**
 * Injects a client-side shim into the <head> for path-based routing support.
 *
 * This handler injects:
 * 1. `window.__BASE_PATH__` - Used by TanStack Router's `rewrite` option to know the base path
 * 2. Fetch interception - Ensures API calls (e.g., /api/hello) are prefixed correctly
 *
 * Note: History API interception is NOT needed because TanStack Router's `rewrite` option
 * handles all client-side navigation by transforming URLs in input/output.
 */
class HeadInjectionHandler implements HTMLRewriterElementContentHandlers {
	private projectId: string;

	constructor(projectId: string) {
		this.projectId = projectId;
	}

	element(element: Element): void | Promise<void> {
		const prefix = `/__project/${this.projectId}`;
		element.prepend(
			`<script>
			(function() {
				const BASE_PATH = '${prefix}';
				// Expose base path for TanStack Router's rewrite option
				window.__BASE_PATH__ = BASE_PATH;

				// Helper to add base path to root-relative URLs
				function addBase(path) {
					if (path.startsWith('/') && !path.startsWith(BASE_PATH) && !path.startsWith('//')) {
						return BASE_PATH + path;
					}
					return path;
				}

				// Intercept fetch() to prefix API calls with the base path
				// This is needed because TanStack Router only handles navigation, not data fetching
				const originalFetch = window.fetch;
				window.fetch = function(input, init) {
					let url;
					if (typeof input === 'string') {
						url = input;
					} else if (input instanceof URL) {
						url = input.toString();
					} else if (input instanceof Request) {
						url = input.url;
					}

					if (url && typeof url === 'string' && url.startsWith('/') && !url.startsWith(BASE_PATH)) {
						if (!url.startsWith('//')) {
							const newUrl = addBase(url);
							if (input instanceof Request) {
								input = new Request(newUrl, input);
							} else {
								input = newUrl;
							}
						}
					}
					return originalFetch.call(this, input, init);
				};
			})();
		</script>`,
			{ html: true },
		);
	}
}

/**
 * Rewrites an HTML response to fix absolute paths for path-based routing.
 *
 * @param response - The original Response to rewrite
 * @param projectId - The project ID to use as prefix
 * @returns A new Response with rewritten paths
 */
export function rewriteHtmlPaths(response: Response, projectId: string): Response {
	let rewriter = new HTMLRewriter();

	// Add handlers for each element type
	for (const [selector, attributes] of Object.entries(PATH_ATTRIBUTES)) {
		rewriter = rewriter.on(selector, new PathRewriteHandler(projectId, attributes));
	}

	// Add handler for inline scripts
	rewriter = rewriter.on('script', new ScriptTextHandler(projectId));

	// Add handler for head injection
	rewriter = rewriter.on('head', new HeadInjectionHandler(projectId));

	return rewriter.transform(response);
}

/**
 * Rewrites a JavaScript response to inject the project base path into asset references.
 * Pattern matches strings starting with /assets/, ./assets/, or assets/
 *
 * @param response - The original Response containing JS
 * @param projectId - The project ID to use as prefix
 * @returns A new Response with rewritten JS
 */
export async function rewriteJsResponse(response: Response, projectId: string): Promise<Response> {
	const originalBody = await response.text();
	const prefix = `/__project/${projectId}`;

	// Rewrite absolute asset paths (/assets/...) in the JS bundle
	const newBody = originalBody.replace(/(["'])(\/assets\/[^"']*)\1/g, (match, quote, path) => {
		return `${quote}${prefix}${path}${quote}`;
	});

	return new Response(newBody, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}
