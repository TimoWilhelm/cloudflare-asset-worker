/**
 * Rewrites HTML and JS responses to fix paths for path-based routing.
 *
 * When using /__project/projectId/ routing, root-relative paths like
 * /assets/main.js need to be prefixed to /__project/projectId/assets/main.js.
 */

/** File extensions that indicate static assets (not API endpoints) */
const ASSET_EXTENSIONS = /\.(js|mjs|css|json|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|map|txt|xml|html)$/i;

/** HTML attributes that may contain paths needing rewriting */
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
 * Checks if a path should be rewritten with the project prefix.
 */
function shouldRewritePath(path: string, prefix: string): boolean {
	if (!path.startsWith('/')) return false; // Not root-relative
	if (path.startsWith('//')) return false; // Protocol-relative URL
	if (path.startsWith(prefix)) return false; // Already prefixed
	return true;
}

/**
 * Rewrites asset paths in a string (for inline scripts and JS files).
 * Only rewrites paths with known asset extensions to avoid breaking API calls.
 */
function rewriteAssetPaths(content: string, prefix: string): string {
	return content.replace(/(["'])(\/[^"'\s]+)\1/g, (match, quote, path) => {
		if (!shouldRewritePath(path, prefix)) return match;
		if (!ASSET_EXTENSIONS.test(path)) return match;
		return `${quote}${prefix}${path}${quote}`;
	});
}

/**
 * Rewrites HTML element attributes (src, href, etc.) with the project prefix.
 */
class PathRewriteHandler implements HTMLRewriterElementContentHandlers {
	constructor(
		private projectId: string,
		private attributes: string[],
	) {}

	element(element: Element): void {
		const prefix = `/__project/${this.projectId}`;

		for (const attr of this.attributes) {
			const value = element.getAttribute(attr);
			if (!value) continue;

			if (attr === 'srcset') {
				const rewritten = this.rewriteSrcset(value, prefix);
				if (rewritten !== value) element.setAttribute(attr, rewritten);
			} else if (shouldRewritePath(value, prefix)) {
				element.setAttribute(attr, prefix + value);
			}
		}
	}

	private rewriteSrcset(srcset: string, prefix: string): string {
		return srcset
			.split(',')
			.map((entry) => {
				const parts = entry.trim().split(/\s+/);
				if (parts[0] && shouldRewritePath(parts[0], prefix)) {
					parts[0] = prefix + parts[0];
				}
				return parts.join(' ');
			})
			.join(', ');
	}
}

/**
 * Rewrites asset paths in inline script content.
 */
class ScriptTextHandler implements HTMLRewriterElementContentHandlers {
	private buffer = '';

	constructor(private projectId: string) {}

	text(text: Text): void {
		this.buffer += text.text;

		if (text.lastInTextNode) {
			const prefix = `/__project/${this.projectId}`;
			const replaced = rewriteAssetPaths(this.buffer, prefix);
			text.replace(replaced, { html: true });
			this.buffer = '';
		} else {
			text.remove();
		}
	}
}

/**
 * Injects a client-side shim for path-based routing (fetch interceptor + base path).
 */
class HeadInjectionHandler implements HTMLRewriterElementContentHandlers {
	constructor(private projectId: string) {}

	element(element: Element): void {
		const prefix = `/__project/${this.projectId}`;
		element.prepend(
			`<script>
(function() {
	const BASE_PATH = '${prefix}';
	window.__BASE_PATH__ = BASE_PATH;

	const originalFetch = window.fetch;
	window.fetch = function(input, init) {
		let url;
		if (typeof input === 'string') {
			url = input;
		} else if (input instanceof URL) {
			url = input.href;
		} else if (input instanceof Request) {
			url = input.url;
		}

		if (url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith(BASE_PATH)) {
			const newUrl = BASE_PATH + url;
			input = input instanceof Request ? new Request(newUrl, input) : newUrl;
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
 * Rewrites an HTML response to fix paths for path-based routing.
 */
export function rewriteHtmlPaths(response: Response, projectId: string): Response {
	let rewriter = new HTMLRewriter();

	for (const [selector, attributes] of Object.entries(PATH_ATTRIBUTES)) {
		rewriter = rewriter.on(selector, new PathRewriteHandler(projectId, attributes));
	}
	rewriter = rewriter.on('script', new ScriptTextHandler(projectId));
	rewriter = rewriter.on('head', new HeadInjectionHandler(projectId));

	return rewriter.transform(response);
}

/**
 * Rewrites a JavaScript response to prefix asset paths for path-based routing.
 */
export async function rewriteJsResponse(response: Response, projectId: string): Promise<Response> {
	const body = await response.text();
	const prefix = `/__project/${projectId}`;
	const rewritten = rewriteAssetPaths(body, prefix);

	return new Response(rewritten, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}
