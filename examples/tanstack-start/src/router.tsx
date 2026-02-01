import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { DefaultCatchBoundary } from './components/DefaultCatchBoundary';
import { NotFound } from './components/NotFound';

// Get base path if running under path-based routing.
// On the client, `__BASE_PATH__` is injected by cf-deploy's HTML rewriter.
// On the server, it's undefined (SSR generates canonical paths, which the HTML rewriter fixes).
const basePath = typeof window !== 'undefined' ? (window as any).__BASE_PATH__ : undefined;

export function getRouter() {
	const router = createRouter({
		routeTree,
		defaultPreload: 'intent',
		defaultErrorComponent: DefaultCatchBoundary,
		defaultNotFoundComponent: () => <NotFound />,
		scrollRestoration: true,
		// Client-side path-based routing for cf-deploy's /__project/:id/ prefix.
		//
		// On the CLIENT: The `rewrite` option transforms URLs so the router works correctly:
		// - `input`: Strips the base path for route matching (/__project/abc/about -> /about)
		// - `output`: Adds the base path for links (<Link to="/about"> -> /__project/abc/about)
		//
		// On the SERVER: `basePath` is undefined, so `rewrite` is disabled. SSR generates
		// canonical paths (e.g., /about, /assets/main.js), which cf-deploy's HTML rewriter
		// then rewrites to include the project prefix before sending to the browser.
		rewrite: basePath
			? {
					input: ({ url }: { url: URL }) => {
						if (url.pathname.startsWith(basePath)) {
							url.pathname = url.pathname.slice(basePath.length) || '/';
						}
						return url;
					},
					output: ({ url }: { url: URL }) => {
						if (!url.pathname.startsWith(basePath)) {
							url.pathname = basePath + url.pathname;
						}
						return url;
					},
				}
			: undefined,
	});

	return router;
}
