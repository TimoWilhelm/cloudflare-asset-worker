// Taken from https://stackoverflow.com/a/3561711
// which is everything from the tc39 proposal, plus the following two characters: ^/
// It's also everything included in the URLPattern escape (https://wicg.github.io/urlpattern/#escape-a-regexp-string), plus the following: -

import type { AssetConfig } from '../configuration';

// As the answer says, there's no downside to escaping these extra characters, so better safe than sorry
const ESCAPE_REGEX_CHARACTERS = /[-/\\^$*+?.()|[\]{}]/g;
const escapeRegex = (str: string) => {
	return str.replace(ESCAPE_REGEX_CHARACTERS, '\\$&');
};

// Placeholder names must begin with a colon then a letter, be alphanumeric and optionally contain underscores.
// e.g. :place_123_holder
const HOST_PLACEHOLDER_REGEX = /(?<=^https:\\\/\\\/[^/]*?):([A-Za-z]\w*)(?=\\)/g;
const PLACEHOLDER_REGEX = /:([A-Za-z]\w*)/g;

export type Replacements = Record<string, string>;

export type Removals = string[];

/**
 * Replaces placeholder tokens in a string with their values.
 *
 * @param str - The string containing :placeholder tokens
 * @param replacements - Map of placeholder names to replacement values
 * @returns The string with all placeholders replaced
 */
export const replacer = (str: string, replacements: Replacements) => {
	for (const [replacement, value] of Object.entries(replacements)) {
		str = str.replaceAll(`:${replacement}`, value);
	}
	return str;
};

/**
 * Generates a RegExp from a glob pattern (supports * wildcards only).
 *
 * @param rule - The glob pattern string
 * @returns A RegExp that matches the pattern
 */
export const generateGlobOnlyRuleRegExp = (rule: string) => {
	// Escape all regex characters other than globs (the "*" character) since that's all that's supported.
	rule = rule.split('*').map(escapeRegex).join('.*');

	// Wrap in line terminators to be safe.
	rule = '^' + rule + '$';

	return RegExp(rule);
};

/**
 * Generates a RegExp from a rule pattern with glob and placeholder support.
 * Supports * wildcards (:splat) and :placeholder tokens.
 *
 * @param rule - The rule pattern string
 * @returns A RegExp with named capture groups for placeholders
 */
export const generateRuleRegExp = (rule: string) => {
	// Create :splat capturer then escape.
	rule = rule.split('*').map(escapeRegex).join('(?<splat>.*)');

	// Create :placeholder capturers (already escaped).
	// For placeholders in the host, we separate at forward slashes and periods.
	// For placeholders in the path, we separate at forward slashes.
	// This matches the behavior of URLPattern.
	// e.g. https://:subdomain.domain/ -> https://(here).domain/
	// e.g. /static/:file -> /static/(image.jpg)
	// e.g. /blog/:post -> /blog/(an-exciting-post)
	const host_matches = rule.matchAll(HOST_PLACEHOLDER_REGEX);
	for (const host_match of host_matches) {
		rule = rule.split(host_match[0]).join(`(?<${host_match[1]}>[^/.]+)`);
	}

	const path_matches = rule.matchAll(PLACEHOLDER_REGEX);
	for (const path_match of path_matches) {
		rule = rule.split(path_match[0]).join(`(?<${path_match[1]}>[^/]+)`);
	}

	// Wrap in line terminators to be safe.
	rule = '^' + rule + '$';

	return RegExp(rule);
};

/**
 * Creates a matcher function for a set of URL pattern rules.
 *
 * @param rules - Map of URL patterns to match values
 * @param replacerFn - Optional function to transform matches with captured replacements
 * @returns A function that takes a request and returns matching rule values
 */
export const generateRulesMatcher = <T>(
	rules?: Record<string, T>,
	replacerFn: (match: T, replacements: Replacements) => T = (match) => match,
) => {
	if (!rules) {
		return () => [];
	}

	const compiledRules = Object.entries(rules)
		.map(([rule, match]) => {
			const crossHost = rule.startsWith('https://');

			try {
				const regExp = generateRuleRegExp(rule);
				return [{ crossHost, regExp }, match];
			} catch {}
		})
		.filter((value) => value !== undefined) as [{ crossHost: boolean; regExp: RegExp }, T][];

	return ({ request }: { request: Request }) => {
		const { pathname, hostname } = new URL(request.url);

		return compiledRules
			.map(([{ crossHost, regExp }, match]) => {
				// This, rather confusingly, means that although we enforce `https://` protocols in
				// the rules of `headers`/`redirects`, we don't actually respect that at all at runtime.
				// When processing a request against an absolute URL rule, we rewrite the protocol to `https://`.
				// This has the benefit of ensuring attackers can't specify a different protocol
				// to circumvent a developer's security rules (e.g. CORS), but it isn't obvious behavior.
				// We should consider different syntax in the future for developers when they specify rules.
				// For example, `*://example.com/path`, `://example.com/path` or `//example.com/`.
				// Though we'd need to be careful with that last one
				// as that would currently be read as a relative URL.
				// Perhaps, if we ever move the `_headers`/`_redirects` files to acting ahead of Functions,
				// this might be a good time for this change.
				const test = crossHost ? `https://${hostname}${pathname}` : pathname;
				const result = regExp.exec(test);
				if (result) {
					return replacerFn(match, result.groups || {});
				}
			})
			.filter((value) => value !== undefined) as T[];
	};
};

/**
 * Matches static redirects from configuration, preferring earlier-defined rules.
 *
 * @param configuration - The normalized asset configuration
 * @param host - The request hostname
 * @param pathname - The request pathname
 * @returns The matching redirect rule or undefined
 */
export const staticRedirectsMatcher = (configuration: Required<AssetConfig>, host: string, pathname: string) => {
	const withHostMatch = configuration.redirects.static[`https://${host}${pathname}`];
	const withoutHostMatch = configuration.redirects.static[pathname];

	if (withHostMatch && withoutHostMatch) {
		if (withHostMatch.lineNumber < withoutHostMatch.lineNumber) {
			return withHostMatch;
		} else {
			return withoutHostMatch;
		}
	}

	return withHostMatch || withoutHostMatch;
};

/**
 * Creates a matcher for dynamic redirect rules with placeholder support.
 *
 * @param configuration - The normalized asset configuration
 * @returns A matcher function for dynamic redirects
 */
export const generateRedirectsMatcher = (configuration: Required<AssetConfig>) =>
	generateRulesMatcher(configuration.redirects.dynamic, ({ status, to }, replacements) => {
		const target = replacer(to, replacements).trim();
		const protoPattern = /^(\w+:\/\/)/;
		if (protoPattern.test(target)) {
			// External redirects are not modified.
			return {
				status,
				to: target,
			};
		} else {
			// Relative redirects are modified to remove multiple slashes.
			return {
				status,
				to: target.replace(/\/+/g, '/'),
			};
		}
	});

/**
 * Creates a matcher for static routing rules using glob patterns.
 *
 * @param rules - Array of glob pattern strings
 * @returns A function that returns true if the request pathname matches any rule
 */
export const generateStaticRoutingRuleMatcher =
	(rules: string[]) =>
	({ request }: { request: Request }) => {
		const { pathname } = new URL(request.url);
		for (const rule of rules) {
			try {
				const regExp = generateGlobOnlyRuleRegExp(rule);
				if (regExp.test(pathname)) {
					return true;
				}
			} catch {}
		}

		return false;
	};
