import { CACHE_CONTROL_BROWSER } from '../constants';
import { generateRulesMatcher, replacer } from './rules-engine';
import type { AssetConfig } from '../configuration';
import type { AssetIntentWithResolver } from '../handler';

/**
 * Generates response headers for an asset request.
 *
 * @param intent - The resolved asset intent with eTag and resolver info
 * @param contentType - The MIME type of the asset
 * @param cacheStatus - The cache status ('CACHE', 'ORIGIN_CACHE', or 'ORIGIN')
 * @param request - The original HTTP request
 * @param configuration - The normalized asset configuration
 * @returns Headers object with ETag, Content-Type, Cache-Control, and X-Asset-Cache-Status
 */
export function getAssetHeaders(
	{ eTag, resolver }: AssetIntentWithResolver,
	contentType: string | undefined,
	cacheStatus: string,
	request: Request,
	configuration: Required<AssetConfig>,
) {
	const headers = new Headers({
		ETag: `"${eTag}"`,
	});

	if (contentType !== undefined) {
		headers.append('Content-Type', contentType);
	}

	if (isCacheable(request)) {
		headers.append('Cache-Control', CACHE_CONTROL_BROWSER);
	}

	// Attach X-Asset-Cache-Status to show users that we are caching assets
	// (using custom header to avoid conflict with Cloudflare's built-in CF-Cache-Status)
	headers.append('X-Asset-Cache-Status', cacheStatus);

	// Always enable debug logging for Sec-Fetch-Mode navigation feature
	if (configuration.debug && resolver === 'not-found') {
		headers.append('X-Asset-Additional-Response-Log', '`Sec-Fetch-Mode: navigate` header present - using `not_found_handling` behavior');
	}

	return headers;
}

function isCacheable(request: Request) {
	return !request.headers.has('Authorization') && !request.headers.has('Range');
}

/**
 * Attaches custom headers from configuration rules to the response.
 *
 * @param request - The original HTTP request for rule matching
 * @param response - The response to modify
 * @param configuration - The normalized asset configuration with header rules
 * @returns The modified response with custom headers applied
 */
export function attachCustomHeaders(request: Request, response: Response, configuration: Required<AssetConfig>) {
	// Iterate through rules and find rules that match the path
	const headersMatcher = generateRulesMatcher(configuration.headers.rules, ({ set = {}, unset = [] }, replacements) => {
		const replacedSet: Record<string, string> = {};
		Object.entries(set).forEach(([key, value]) => {
			replacedSet[key] = replacer(value, replacements);
		});
		return {
			set: replacedSet,
			unset,
		};
	});
	const matches = headersMatcher({ request });

	// This keeps track of every header that we've set from config headers
	// because we want to combine user declared headers but overwrite
	// existing and extra ones
	const setMap = new Set();
	// Apply every matched rule in order
	matches.forEach(({ set = {}, unset = [] }) => {
		unset.forEach((key) => {
			response.headers.delete(key);
		});
		Object.entries(set).forEach(([key, value]) => {
			if (setMap.has(key.toLowerCase())) {
				response.headers.append(key, value);
			} else {
				response.headers.set(key, value);
				setMap.add(key.toLowerCase());
			}
		});
	});

	return response;
}
