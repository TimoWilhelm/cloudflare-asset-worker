/**
 * Validation schemas and constants using Zod for the Router API.
 * Centralizes all limits and validation logic for consistency.
 */

import { z } from 'zod';

import { MAX_STATIC_REDIRECTS, MAX_DYNAMIC_REDIRECTS } from '../../shared/limits';

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Formats byte values into human-readable sizes.
 *
 * @param bytes - The number of bytes to format
 * @param decimals - Number of decimal places (default: 2)
 * @param binary - If true, uses binary units (KiB, MiB, base-1024). If false, uses decimal units (KB, MB, base-1000). Default: true
 * @returns Formatted string with appropriate unit
 */
export function formatBytes(bytes: number, decimals: number = 2, binary: boolean = true): string {
	if (bytes < 0) return `-${formatBytes(-bytes, decimals, binary)}`;
	if (bytes === 0) return '0 B';
	if (bytes === 1) return '1 B';

	const k = binary ? 1024 : 1000;
	const dm = Math.max(decimals, 0);
	const sizes = binary ? ['B', 'KiB', 'MiB', 'GiB', 'TiB'] : ['B', 'KB', 'MB', 'GB', 'TB'];

	const index = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
	const value = bytes / Math.pow(k, index);

	// Don't show decimals for whole numbers
	const formatted = value % 1 === 0 ? value.toString() : value.toFixed(dm);

	return `${formatted} ${sizes[index]}`;
}

// =============================================================================
// Limits
// =============================================================================

/** Maximum number of files in a manifest */
export const MAX_MANIFEST_ENTRIES = 20_000;

/** Maximum size for a single asset file (25 MiB) */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Maximum length of an asset pathname (including leading slash) */
export const MAX_PATHNAME_LENGTH = 1024;

/** Maximum files per upload request */
export const MAX_FILES_PER_REQUEST = 50;

/** Maximum total size for all server-side code modules (10 MB) */
export const MAX_TOTAL_SERVER_CODE_SIZE = 10 * 1000 * 1000;

/** Maximum length of a server-side code module path */
export const MAX_MODULE_PATH_LENGTH = 512;

/** Maximum number of environment variables */
export const MAX_ENV_VARS = 64;

/** Maximum length of an environment variable name */
export const MAX_ENV_VAR_NAME_LENGTH = 128;

/** Maximum size for a single environment variable value (5 KB) */
export const MAX_ENV_VAR_SIZE = 5 * 1000;

/** Maximum length of a project name */
export const MAX_PROJECT_NAME_LENGTH = 128;

// Re-export shared limits for backward compatibility

/** Maximum length of a redirect pattern (source path) */
export const MAX_REDIRECT_PATTERN_LENGTH = 2048;

/** Maximum length of a redirect target URL */
export const MAX_REDIRECT_TARGET_LENGTH = 2048;

/** Maximum length of a header rule pattern (path matcher) */
export const MAX_HEADER_RULE_PATTERN_LENGTH = 2048;

/** Maximum length of a header name */
export const MAX_HEADER_NAME_LENGTH = 256;

/** Maximum length of a header value */
export const MAX_HEADER_VALUE_LENGTH = 8192;

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Schema for a single manifest entry.
 * Validates hash (64 hex chars) and file size.
 */
export const manifestEntrySchema = z.object({
	hash: z
		.string()
		.length(64)
		.regex(/^[0-9a-f]{64}$/i, 'Hash must be 64 hexadecimal characters'),
	size: z
		.number()
		.int()
		.nonnegative()
		.max(MAX_FILE_SIZE, `File size cannot exceed ${formatBytes(MAX_FILE_SIZE, 2, true)}`), // Binary (MiB)
});

/**
 * Schema for an asset manifest.
 * Validates pathname format and enforces manifest size limits.
 */
export const manifestSchema = z
	.record(
		z
			.string()
			.min(1, 'Pathname cannot be empty')
			.max(MAX_PATHNAME_LENGTH, `Pathname cannot exceed ${MAX_PATHNAME_LENGTH} characters`)
			.refine((pathname) => pathname.startsWith('/'), {
				message: 'Pathname must start with /',
			}),
		manifestEntrySchema,
	)
	.refine((manifest) => Object.keys(manifest).length > 0, {
		message: 'Manifest cannot be empty',
	})
	.refine((manifest) => Object.keys(manifest).length <= MAX_MANIFEST_ENTRIES, {
		message: `Manifest cannot exceed ${MAX_MANIFEST_ENTRIES} files`,
	});

/**
 * Schema for upload payload.
 * Validates hash keys and base64 content.
 */
export const uploadPayloadSchema = z
	.record(
		z
			.string()
			.length(64)
			.regex(/^[0-9a-f]{64}$/i),
		z.string(),
	)
	.refine((payload) => Object.keys(payload).length > 0, {
		message: 'Upload payload cannot be empty',
	})
	.refine((payload) => Object.keys(payload).length <= MAX_FILES_PER_REQUEST, {
		message: `Cannot upload more than ${MAX_FILES_PER_REQUEST} files per request`,
	});

/**
 * Schema for environment variables.
 * Validates count, key names, and value sizes.
 */
export const environmentVariablesSchema = z
	.record(
		z
			.string()
			.min(1, 'Environment variable name cannot be empty')
			.max(MAX_ENV_VAR_NAME_LENGTH, `Environment variable name cannot exceed ${MAX_ENV_VAR_NAME_LENGTH} characters`),
		z.string(),
	)
	.superRefine((environment, context) => {
		const environmentVariableCount = Object.keys(environment).length;
		if (environmentVariableCount > MAX_ENV_VARS) {
			context.addIssue({
				code: 'custom',
				message: `Too many environment variables: ${environmentVariableCount}. Maximum allowed is ${MAX_ENV_VARS}.`,
			});
		}

		for (const [key, value] of Object.entries(environment)) {
			const valueSize = new TextEncoder().encode(String(value)).length;
			if (valueSize > MAX_ENV_VAR_SIZE) {
				context.addIssue({
					code: 'custom',
					path: [key],
					message: `Environment variable '${key}' is too large: ${formatBytes(valueSize, 2, false)}. Maximum allowed is ${formatBytes(
						MAX_ENV_VAR_SIZE,
						2,
						false,
					)}.`,
				});
			}
		}
	})
	.optional();

/**
 * Schema for server-side code size validation.
 * Used to validate total decoded server-side code size.
 */
export const serverCodeSizeSchema = z
	.number()
	.max(MAX_TOTAL_SERVER_CODE_SIZE, `Server-side code cannot exceed ${formatBytes(MAX_TOTAL_SERVER_CODE_SIZE, 2, false)}.`); // Decimal (MB)

/**
 * Schema for project name validation.
 */
export const projectNameSchema = z
	.string()
	.min(1, 'Project name cannot be empty')
	.max(MAX_PROJECT_NAME_LENGTH, `Project name cannot exceed ${MAX_PROJECT_NAME_LENGTH} characters`)
	.optional();

/**
 * Schema for module path validation.
 */
export const modulePathSchema = z
	.string()
	.min(1, 'Module path cannot be empty')
	.max(MAX_MODULE_PATH_LENGTH, `Module path cannot exceed ${MAX_MODULE_PATH_LENGTH} characters`);

/**
 * Schema for module types.
 */
const moduleTypeSchema = z.enum(['js', 'cjs', 'py', 'text', 'data', 'json', 'wasm']);

/**
 * Schema for a server-side code module (either base64 string or object with content and type).
 */
const serverCodeModuleSchema = z.union([
	z.string(), // Base64 content
	z.object({
		content: z.string(), // Base64 content
		type: moduleTypeSchema,
	}),
]);

// =============================================================================
// Asset Configuration Schema
// =============================================================================

/**
 * Schema for a redirect rule entry.
 */
const redirectRuleSchema = z.object({
	status: z.number().int().min(200).max(599),
	to: z
		.string()
		.min(1, 'Redirect target cannot be empty')
		.max(MAX_REDIRECT_TARGET_LENGTH, `Redirect target cannot exceed ${MAX_REDIRECT_TARGET_LENGTH} characters`),
});

/** Schema for redirect pattern (source path) */
const redirectPatternSchema = z
	.string()
	.min(1, 'Redirect pattern cannot be empty')
	.max(MAX_REDIRECT_PATTERN_LENGTH, `Redirect pattern cannot exceed ${MAX_REDIRECT_PATTERN_LENGTH} characters`);

/** Schema for header name */
const headerNameSchema = z
	.string()
	.min(1, 'Header name cannot be empty')
	.max(MAX_HEADER_NAME_LENGTH, `Header name cannot exceed ${MAX_HEADER_NAME_LENGTH} characters`);

/** Schema for header value */
const headerValueSchema = z.string().max(MAX_HEADER_VALUE_LENGTH, `Header value cannot exceed ${MAX_HEADER_VALUE_LENGTH} characters`);

/** Schema for header rule pattern (path matcher) */
const headerRulePatternSchema = z
	.string()
	.min(1, 'Header rule pattern cannot be empty')
	.max(MAX_HEADER_RULE_PATTERN_LENGTH, `Header rule pattern cannot exceed ${MAX_HEADER_RULE_PATTERN_LENGTH} characters`);

/**
 * Schema for header rules.
 */
const headerRuleSchema = z.object({
	set: z.record(headerNameSchema, headerValueSchema).optional(),
	unset: z.array(headerNameSchema).optional(),
});

/**
 * Schema for AssetConfigInput (user-provided configuration).
 * Validates redirect limits and structure.
 */
export const assetConfigSchema = z
	.object({
		html_handling: z.enum(['auto-trailing-slash', 'force-trailing-slash', 'drop-trailing-slash', 'none']).optional(),
		not_found_handling: z.enum(['single-page-application', '404-page', 'none']).optional(),
		redirects: z
			.object({
				static: z.record(redirectPatternSchema, redirectRuleSchema).optional(),
				dynamic: z.record(redirectPatternSchema, redirectRuleSchema).optional(),
			})
			.superRefine((redirects, context) => {
				if (redirects.static) {
					const staticCount = Object.keys(redirects.static).length;
					if (staticCount > MAX_STATIC_REDIRECTS) {
						context.addIssue({
							code: 'custom',
							path: ['static'],
							message: `Too many static redirects: ${staticCount}. Maximum allowed is ${MAX_STATIC_REDIRECTS}.`,
						});
					}
				}
				if (redirects.dynamic) {
					const dynamicCount = Object.keys(redirects.dynamic).length;
					if (dynamicCount > MAX_DYNAMIC_REDIRECTS) {
						context.addIssue({
							code: 'custom',
							path: ['dynamic'],
							message: `Too many dynamic redirects: ${dynamicCount}. Maximum allowed is ${MAX_DYNAMIC_REDIRECTS}.`,
						});
					}
				}
			})
			.optional(),
		headers: z
			.object({
				rules: z.record(headerRulePatternSchema, headerRuleSchema),
			})
			.optional(),
		has_static_routing: z.boolean().optional(),
		debug: z.boolean().optional(),
	})
	.optional();

/**
 * Schema for the entire deployment payload.
 * Validates project name, environment variables, server-side code modules, and configuration.
 */
export const deploymentPayloadSchema = z.object({
	projectName: projectNameSchema,
	completionJwt: z.string().optional(),
	server: z
		.object({
			entrypoint: z.string().min(1, 'Entrypoint cannot be empty'),
			modules: z.record(modulePathSchema, serverCodeModuleSchema).superRefine((modules, context) => {
				// Validate total server-side code size
				let totalSize = 0;
				for (const [_path, moduleData] of Object.entries(modules)) {
					try {
						const base64Content = typeof moduleData === 'string' ? moduleData : moduleData.content;
						// Estimate decoded size (base64 is ~4/3 the size of original)
						const decodedSize = Math.ceil((base64Content.length * 3) / 4);
						totalSize += decodedSize;
					} catch {
						// If we can't decode, skip size check for this module
						continue;
					}
				}

				if (totalSize > MAX_TOTAL_SERVER_CODE_SIZE) {
					context.addIssue({
						code: 'custom',
						message: `Server-side code cannot exceed ${formatBytes(MAX_TOTAL_SERVER_CODE_SIZE, 2, false)}.`,
					});
				}
			}),
			compatibilityDate: z.string().optional(),
		})
		.optional(),
	config: assetConfigSchema,
	run_worker_first: z.union([z.boolean(), z.array(z.string())]).optional(),
	env: environmentVariablesSchema,
});

/**
 * Schema for asset manifest request payload.
 */
export const assetManifestRequestSchema = z.object({
	manifest: manifestSchema,
});

/**
 * Schema for create project request payload.
 */
export const createProjectRequestSchema = z.object({
	name: projectNameSchema,
});

export { MAX_STATIC_REDIRECTS, MAX_DYNAMIC_REDIRECTS } from '../../shared/limits';
