/**
 * Core asset request handler with HTML handling, redirects, and content negotiation.
 *
 * @remarks
 * This module is **storage-agnostic**: it operates entirely through two callbacks
 * (`exists` and `getByETag`) that can be backed by KV, Durable Object storage,
 * an in-memory map, or any other storage layer.
 */

import { attachCustomHeaders, getAssetHeaders } from './utils/headers';
import {
	FoundResponse,
	InternalServerErrorResponse,
	MethodNotAllowedResponse,
	MovedPermanentlyResponse,
	NoIntentResponse,
	NotFoundResponse,
	NotModifiedResponse,
	OkResponse,
	PermanentRedirectResponse,
	SeeOtherResponse,
	TemporaryRedirectResponse,
} from './utils/responses';
import { generateRedirectsMatcher, staticRedirectsMatcher } from './utils/rules-engine';

import type { AssetConfig } from './configuration';

/** Callback to check if an asset exists at the given pathname. Returns the content hash or `undefined`. */
export type Exists = (pathname: string, request: Request) => Promise<string | undefined>;

/** Callback to retrieve an asset by its content hash. */
export type GetByETag = (
	eTag: string,
	request: Request,
) => Promise<{
	readableStream: ReadableStream;
	contentType: string | undefined;
	cacheStatus: 'HIT' | 'MISS';
}>;

type AssetIntent = {
	eTag: string;
	status: typeof OkResponse.status | typeof NotFoundResponse.status;
	/** The resolved file pathname that matched in the manifest (e.g. `/about.html`). */
	pathname: string;
};

/** An asset intent paired with the resolver that produced it. */
export type AssetIntentWithResolver = AssetIntent & { resolver: Resolver };

type Resolver = 'html-handling' | 'not-found';
type Intent =
	| { asset: AssetIntent; redirect: undefined; resolver: Resolver }
	| { asset: undefined; redirect: string; resolver: Resolver }
	| undefined;

/**
 * Determines whether an asset can be served for the given request.
 *
 * @param request - The HTTP request to check
 * @param configuration - The normalized asset configuration
 * @param exists - Callback to check if a pathname exists in the manifest
 * @returns `true` if an asset can be served
 */
export const canFetch = async (request: Request, configuration: Required<AssetConfig>, exists: Exists): Promise<boolean> => {
	const shouldKeepNotFoundHandling = configuration.has_static_routing || request.headers.get('Sec-Fetch-Mode') === 'navigate';
	if (!shouldKeepNotFoundHandling) {
		configuration = {
			...configuration,
			not_found_handling: 'none',
			redirects: {
				static: { ...configuration.redirects.static },
				dynamic: { ...configuration.redirects.dynamic },
			},
			headers: { rules: { ...configuration.headers.rules } },
		};
	}
	const result = await getResponseOrAssetIntent(request, configuration, exists);
	return !(result instanceof NoIntentResponse);
};

/**
 * Handles an incoming request and returns the appropriate response.
 *
 * @param request - The HTTP request to handle
 * @param configuration - The normalized asset configuration
 * @param exists - Callback to check if a pathname exists
 * @param getByETag - Callback to retrieve an asset by content hash
 * @returns The HTTP response (asset, redirect, or error)
 */
export const handleRequest = async (
	request: Request,
	configuration: Required<AssetConfig>,
	exists: Exists,
	getByETag: GetByETag,
): Promise<Response> => {
	const result = await getResponseOrAssetIntent(request, configuration, exists);
	const response = result instanceof Response ? result : await resolveAssetIntentToResponse(result, request, configuration, getByETag);
	return attachCustomHeaders(request, response, configuration);
};

/** Shorthand to build an asset intent for an OK response. */
const okIntent = (eTag: string, pathname: string, resolver: Resolver): Intent => ({
	asset: { eTag, status: OkResponse.status, pathname },
	redirect: undefined,
	resolver,
});

/** Shorthand to build an asset intent for a 404 response. */
const notFoundIntent = (eTag: string, pathname: string, resolver: Resolver): Intent => ({
	asset: { eTag, status: NotFoundResponse.status, pathname },
	redirect: undefined,
	resolver,
});

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

const getResponseOrAssetIntent = async (
	request: Request,
	configuration: Required<AssetConfig>,
	exists: Exists,
): Promise<Response | AssetIntentWithResolver> => {
	const url = new URL(request.url);
	const { search } = url;

	const redirectResult = handleRedirects(request, configuration, url.host, url.pathname, search);
	if (redirectResult instanceof Response) return redirectResult;
	const { proxied, pathname } = redirectResult;

	const decodedPathname = decodePath(pathname);
	const intent = await getIntent(decodedPathname, request, configuration, exists);

	if (!intent) {
		return proxied ? new NotFoundResponse() : new NoIntentResponse();
	}

	const method = request.method.toUpperCase();
	if (!['GET', 'HEAD'].includes(method)) {
		return new MethodNotAllowedResponse();
	}

	const decodedDestination = intent.redirect ?? decodedPathname;
	const encodedDestination = encodePath(decodedDestination);

	if ((encodedDestination !== pathname && intent.asset) || intent.redirect) {
		return new TemporaryRedirectResponse(encodedDestination + search);
	}

	if (!intent.asset) {
		return new InternalServerErrorResponse(new Error('Unknown action'));
	}

	return { ...intent.asset, resolver: intent.resolver };
};

const resolveAssetIntentToResponse = async (
	assetIntent: AssetIntentWithResolver,
	request: Request,
	configuration: Required<AssetConfig>,
	getByETag: GetByETag,
): Promise<Response> => {
	const method = request.method.toUpperCase();
	const asset = await getByETag(assetIntent.eTag, request);
	const headers = getAssetHeaders(assetIntent, asset.contentType, asset.cacheStatus, request, configuration);

	const strongETag = `"${assetIntent.eTag}"`;
	const weakETag = `W/${strongETag}`;
	const ifNoneMatch = request.headers.get('If-None-Match') || '';
	const eTags = new Set(ifNoneMatch.split(',').map((tag) => tag.trim()));
	if (eTags.has(weakETag) || eTags.has(strongETag)) {
		asset.readableStream.cancel().catch(() => {});
		return new NotModifiedResponse(undefined, { headers });
	}

	let body: ReadableStream | undefined;
	if (method === 'HEAD') {
		asset.readableStream.cancel().catch(() => {});
	} else {
		body = asset.readableStream;
	}
	switch (assetIntent.status) {
		case NotFoundResponse.status: {
			return new NotFoundResponse(body, { headers });
		}
		case OkResponse.status: {
			return new OkResponse(body, { headers });
		}
		default: {
			return new InternalServerErrorResponse(new Error(`Unexpected status: ${assetIntent.status}`));
		}
	}
};

/**
 * Resolves the intent for a given pathname based on HTML handling configuration.
 *
 * @param pathname - The decoded URL pathname
 * @param request - The HTTP request
 * @param configuration - The normalized asset configuration
 * @param exists - Callback to check if a pathname exists
 * @param skipRedirects - Internal flag to prevent redirect loops
 * @returns The resolved intent (asset to serve, redirect to issue, or `undefined`)
 */
export const getIntent = async (
	pathname: string,
	request: Request,
	configuration: Required<AssetConfig>,
	exists: Exists,
	skipRedirects = false,
): Promise<Intent> => {
	switch (configuration.html_handling) {
		case 'auto-trailing-slash': {
			return htmlHandlingAutoTrailingSlash(pathname, request, configuration, exists, skipRedirects);
		}
		case 'force-trailing-slash': {
			return htmlHandlingForceTrailingSlash(pathname, request, configuration, exists, skipRedirects);
		}
		case 'drop-trailing-slash': {
			return htmlHandlingDropTrailingSlash(pathname, request, configuration, exists, skipRedirects);
		}
		case 'none': {
			return htmlHandlingNone(pathname, request, configuration, exists);
		}
	}
};

// ---------------------------------------------------------------------------
// HTML handling strategies
// ---------------------------------------------------------------------------

const htmlHandlingAutoTrailingSlash = async (
	pathname: string,
	request: Request,
	configuration: Required<AssetConfig>,
	exists: Exists,
	skipRedirects: boolean,
): Promise<Intent> => {
	let redirectResult: Intent;
	let eTagResult: string | undefined;
	const exactETag = await exists(pathname, request);

	if (pathname.endsWith('/index')) {
		if (exactETag) {
			return okIntent(exactETag, pathname, 'html-handling');
		}
		if (
			(redirectResult = await safeRedirect(
				`${pathname}.html`,
				request,
				pathname.slice(0, -'index'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
		if (
			(redirectResult = await safeRedirect(
				`${pathname.slice(0, -'/index'.length)}.html`,
				request,
				pathname.slice(0, -'/index'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
	} else if (pathname.endsWith('/index.html')) {
		if (
			(redirectResult = await safeRedirect(
				pathname,
				request,
				pathname.slice(0, -'index.html'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
		if (
			(redirectResult = await safeRedirect(
				`${pathname.slice(0, -'/index.html'.length)}.html`,
				request,
				pathname.slice(0, -'/index.html'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
	} else if (pathname.endsWith('/')) {
		if ((eTagResult = await exists(`${pathname}index.html`, request))) {
			return okIntent(eTagResult, `${pathname}index.html`, 'html-handling');
		}
		if (
			(redirectResult = await safeRedirect(
				`${pathname.slice(0, -'/'.length)}.html`,
				request,
				pathname.slice(0, -'/'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
	} else if (pathname.endsWith('.html')) {
		if (
			(redirectResult = await safeRedirect(
				pathname,
				request,
				pathname.slice(0, -'.html'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
		if (
			(redirectResult = await safeRedirect(
				`${pathname.slice(0, -'.html'.length)}/index.html`,
				request,
				`${pathname.slice(0, -'.html'.length)}/`,
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
	}

	if (exactETag) {
		return okIntent(exactETag, pathname, 'html-handling');
	}
	if ((eTagResult = await exists(`${pathname}.html`, request))) {
		return okIntent(eTagResult, `${pathname}.html`, 'html-handling');
	}
	if (
		(redirectResult = await safeRedirect(
			`${pathname}/index.html`,
			request,
			`${pathname}/`,
			configuration,
			exists,
			skipRedirects,
			'html-handling',
		))
	)
		return redirectResult;

	return notFound(pathname, request, configuration, exists);
};

const htmlHandlingForceTrailingSlash = async (
	pathname: string,
	request: Request,
	configuration: Required<AssetConfig>,
	exists: Exists,
	skipRedirects: boolean,
): Promise<Intent> => {
	let redirectResult: Intent;
	let eTagResult: string | undefined;
	const exactETag = await exists(pathname, request);

	if (pathname.endsWith('/index')) {
		if (exactETag) {
			return okIntent(exactETag, pathname, 'html-handling');
		}
		if (
			(redirectResult = await safeRedirect(
				`${pathname}.html`,
				request,
				pathname.slice(0, -'index'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
		if (
			(redirectResult = await safeRedirect(
				`${pathname.slice(0, -'/index'.length)}.html`,
				request,
				pathname.slice(0, -'index'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
	} else if (pathname.endsWith('/index.html')) {
		if (
			(redirectResult = await safeRedirect(
				pathname,
				request,
				pathname.slice(0, -'index.html'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
		if (
			(redirectResult = await safeRedirect(
				`${pathname.slice(0, -'/index.html'.length)}.html`,
				request,
				pathname.slice(0, -'index.html'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
	} else if (pathname.endsWith('/')) {
		if ((eTagResult = await exists(`${pathname}index.html`, request))) {
			return okIntent(eTagResult, `${pathname}index.html`, 'html-handling');
		}
		if ((eTagResult = await exists(`${pathname.slice(0, -'/'.length)}.html`, request))) {
			return okIntent(eTagResult, `${pathname.slice(0, -'/'.length)}.html`, 'html-handling');
		}
	} else if (pathname.endsWith('.html')) {
		if (
			(redirectResult = await safeRedirect(
				pathname,
				request,
				`${pathname.slice(0, -'.html'.length)}/`,
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
		if (exactETag) {
			return okIntent(exactETag, pathname, 'html-handling');
		}
		if (
			(redirectResult = await safeRedirect(
				`${pathname.slice(0, -'.html'.length)}/index.html`,
				request,
				`${pathname.slice(0, -'.html'.length)}/`,
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
	}

	if (exactETag) {
		return okIntent(exactETag, pathname, 'html-handling');
	}
	if (
		(redirectResult = await safeRedirect(
			`${pathname}.html`,
			request,
			`${pathname}/`,
			configuration,
			exists,
			skipRedirects,
			'html-handling',
		))
	)
		return redirectResult;
	if (
		(redirectResult = await safeRedirect(
			`${pathname}/index.html`,
			request,
			`${pathname}/`,
			configuration,
			exists,
			skipRedirects,
			'html-handling',
		))
	)
		return redirectResult;

	return notFound(pathname, request, configuration, exists);
};

const htmlHandlingDropTrailingSlash = async (
	pathname: string,
	request: Request,
	configuration: Required<AssetConfig>,
	exists: Exists,
	skipRedirects: boolean,
): Promise<Intent> => {
	let redirectResult: Intent;
	let eTagResult: string | undefined;
	const exactETag = await exists(pathname, request);

	if (pathname.endsWith('/index')) {
		if (exactETag) {
			return okIntent(exactETag, pathname, 'html-handling');
		}
		if (pathname === '/index') {
			if ((redirectResult = await safeRedirect('/index.html', request, '/', configuration, exists, skipRedirects, 'html-handling')))
				return redirectResult;
		} else {
			if (
				(redirectResult = await safeRedirect(
					`${pathname.slice(0, -'/index'.length)}.html`,
					request,
					pathname.slice(0, -'/index'.length),
					configuration,
					exists,
					skipRedirects,
					'html-handling',
				))
			)
				return redirectResult;
			if (
				(redirectResult = await safeRedirect(
					`${pathname}.html`,
					request,
					pathname.slice(0, -'/index'.length),
					configuration,
					exists,
					skipRedirects,
					'html-handling',
				))
			)
				return redirectResult;
		}
	} else if (pathname.endsWith('/index.html')) {
		if (pathname === '/index.html') {
			if ((redirectResult = await safeRedirect('/index.html', request, '/', configuration, exists, skipRedirects, 'html-handling')))
				return redirectResult;
		} else {
			if (
				(redirectResult = await safeRedirect(
					pathname,
					request,
					pathname.slice(0, -'/index.html'.length),
					configuration,
					exists,
					skipRedirects,
					'html-handling',
				))
			)
				return redirectResult;
			if (exactETag) {
				return okIntent(exactETag, pathname, 'html-handling');
			}
			if (
				(redirectResult = await safeRedirect(
					`${pathname.slice(0, -'/index.html'.length)}.html`,
					request,
					pathname.slice(0, -'/index.html'.length),
					configuration,
					exists,
					skipRedirects,
					'html-handling',
				))
			)
				return redirectResult;
		}
	} else if (pathname.endsWith('/')) {
		if (pathname === '/') {
			if ((eTagResult = await exists('/index.html', request))) {
				return okIntent(eTagResult, '/index.html', 'html-handling');
			}
		} else {
			if (
				(redirectResult = await safeRedirect(
					`${pathname.slice(0, -'/'.length)}.html`,
					request,
					pathname.slice(0, -'/'.length),
					configuration,
					exists,
					skipRedirects,
					'html-handling',
				))
			)
				return redirectResult;
			if (
				(redirectResult = await safeRedirect(
					`${pathname.slice(0, -'/'.length)}/index.html`,
					request,
					pathname.slice(0, -'/'.length),
					configuration,
					exists,
					skipRedirects,
					'html-handling',
				))
			)
				return redirectResult;
		}
	} else if (pathname.endsWith('.html')) {
		if (
			(redirectResult = await safeRedirect(
				pathname,
				request,
				pathname.slice(0, -'.html'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
		if (
			(redirectResult = await safeRedirect(
				`${pathname.slice(0, -'.html'.length)}/index.html`,
				request,
				pathname.slice(0, -'.html'.length),
				configuration,
				exists,
				skipRedirects,
				'html-handling',
			))
		)
			return redirectResult;
	}

	if (exactETag) {
		return okIntent(exactETag, pathname, 'html-handling');
	}
	if ((eTagResult = await exists(`${pathname}.html`, request))) {
		return okIntent(eTagResult, `${pathname}.html`, 'html-handling');
	}
	if ((eTagResult = await exists(`${pathname}/index.html`, request))) {
		return okIntent(eTagResult, `${pathname}/index.html`, 'html-handling');
	}

	return notFound(pathname, request, configuration, exists);
};

const htmlHandlingNone = async (
	pathname: string,
	request: Request,
	configuration: Required<AssetConfig>,
	exists: Exists,
): Promise<Intent> => {
	const exactETag = await exists(pathname, request);
	return exactETag ? okIntent(exactETag, pathname, 'html-handling') : notFound(pathname, request, configuration, exists);
};

// ---------------------------------------------------------------------------
// Not-found handling
// ---------------------------------------------------------------------------

const notFound = async (pathname: string, request: Request, configuration: Required<AssetConfig>, exists: Exists): Promise<Intent> => {
	switch (configuration.not_found_handling) {
		case 'single-page-application': {
			const eTag = await exists('/index.html', request);
			if (eTag) {
				return okIntent(eTag, '/index.html', 'not-found');
			}
			return;
		}
		case '404-page': {
			let cwd = pathname;
			while (cwd) {
				cwd = cwd.slice(0, cwd.lastIndexOf('/'));
				const notFoundPath = `${cwd}/404.html`;
				const eTag = await exists(notFoundPath, request);
				if (eTag) {
					return notFoundIntent(eTag, notFoundPath, 'not-found');
				}
			}
			return;
		}
		default: {
			return;
		}
	}
};

// ---------------------------------------------------------------------------
// Redirect safety check
// ---------------------------------------------------------------------------

const safeRedirect = async (
	file: string,
	request: Request,
	destination: string,
	configuration: Required<AssetConfig>,
	exists: Exists,
	skip: boolean,
	resolver: Resolver,
): Promise<Intent> => {
	if (skip) return;
	if (!(await exists(destination, request))) {
		const intent = await getIntent(destination, request, configuration, exists, true);
		if (intent?.asset && intent.asset.eTag === (await exists(file, request))) {
			return { asset: undefined, redirect: destination, resolver };
		}
	}
	return;
};

// ---------------------------------------------------------------------------
// Path encoding / decoding
// ---------------------------------------------------------------------------

/**
 * +===========================================+===========+======================+
 * |              character type               |  fetch()  | encodeURIComponent() |
 * +===========================================+===========+======================+
 * | unreserved ASCII e.g. a-z                 | unchanged | unchanged            |
 * +-------------------------------------------+-----------+----------------------+
 * | reserved (sometimes encoded)              | unchanged | encoded              |
 * | e.g. [ ] @ $ ! ' ( ) * + , ; = : ? # & %  |           |                      |
 * +-------------------------------------------+-----------+----------------------+
 * | non-ASCII e.g. ü. and space               | encoded   | encoded              |
 * +-------------------------------------------+-----------+----------------------+
 *
 * 1. Decode incoming path to handle non-ASCII characters or optionally encoded characters (e.g. square brackets)
 * 2. Match decoded path to manifest
 * 3. Re-encode the path and redirect if the re-encoded path is different from the original path
 *
 * If the user uploads a file that is already URL-encoded, that is accessible only at the (double) encoded path.
 * e.g. /%5Bboop%5D.html is served at /%255Bboop%255D only
 */

/** Decodes URL-encoded path segments and normalizes multiple slashes. */
const decodePath = (pathname: string): string =>
	pathname
		.split('/')
		.map((s) => {
			try {
				return decodeURIComponent(s);
			} catch {
				return s;
			}
		})
		.join('/')
		.replaceAll(/\/+/g, '/');

/** Encodes path segments for use as the canonical URL form. */
const encodePath = (pathname: string): string =>
	pathname
		.split('/')
		.map((s) => {
			try {
				return encodeURIComponent(s);
			} catch {
				return s;
			}
		})
		.join('/');

// ---------------------------------------------------------------------------
// Redirect matching
// ---------------------------------------------------------------------------

const handleRedirects = (
	request: Request,
	configuration: Required<AssetConfig>,
	host: string,
	pathname: string,
	search: string,
): { proxied: boolean; pathname: string } | Response => {
	const redirectMatch = staticRedirectsMatcher(configuration, host, pathname) || generateRedirectsMatcher(configuration)({ request })[0];

	let proxied = false;
	if (redirectMatch) {
		if (redirectMatch.status === 200) {
			pathname = new URL(redirectMatch.to, request.url).pathname;
			proxied = true;
		} else {
			const { status, to } = redirectMatch;
			const destination = new URL(to, request.url);
			const location =
				destination.origin === new URL(request.url).origin
					? `${destination.pathname}${destination.search || search}${destination.hash}`
					: `${destination.href.slice(0, destination.href.length - (destination.search.length + destination.hash.length))}${destination.search || search}${destination.hash}`;

			switch (status) {
				case MovedPermanentlyResponse.status: {
					return new MovedPermanentlyResponse(location);
				}
				case SeeOtherResponse.status: {
					return new SeeOtherResponse(location);
				}
				case TemporaryRedirectResponse.status: {
					return new TemporaryRedirectResponse(location);
				}
				case PermanentRedirectResponse.status: {
					return new PermanentRedirectResponse(location);
				}
				default: {
					return new FoundResponse(location);
				}
			}
		}
	}

	return { proxied, pathname };
};
