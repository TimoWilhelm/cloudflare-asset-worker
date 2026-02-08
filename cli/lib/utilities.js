import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { glob } from 'glob';
import mime from 'mime-types';

/**
 * Load and parse configuration file
 * @param {string} configPath - Path to config file
 * @returns {Promise<Object>} Parsed configuration
 */
export async function loadConfig(configPath) {
	const configContent = await fs.readFile(configPath, 'utf8');
	const config = JSON.parse(configContent);

	// Replace environment variable placeholders in env section (optional substitution)
	// This allows ${VAR} syntax in the env section to reference local environment variables
	if (config.env) {
		const environmentString = JSON.stringify(config.env);
		const replacedString = environmentString.replaceAll(/\$\{([^}]+)\}/g, (match, environmentVariable) => {
			const value = process.env[environmentVariable];
			// Keep original if not found (don't throw error)
			return value === undefined ? match : value;
		});
		config.env = JSON.parse(replacedString);
	}

	return config;
}

/**
 * Scan directory for assets based on patterns
 * @param {string} directory - Base directory to scan
 * @param {Array<string>} patterns - Glob patterns to include
 * @param {Array<string>} ignore - Glob patterns to ignore
 * @returns {Promise<Array<Object>>} Array of asset objects
 */
export async function scanAssets(directory, patterns = ['**/*'], ignore = []) {
	const assets = [];
	const absoluteDirectory = path.resolve(directory);

	// Ensure directory exists
	try {
		await fs.access(absoluteDirectory);
	} catch {
		throw new Error(`Assets directory not found: ${absoluteDirectory}`);
	}

	// Scan files using glob patterns
	const files = await glob(patterns, {
		cwd: absoluteDirectory,
		ignore,
		nodir: true,
		dot: false,
	});

	const MAX_ASSET_SIZE = 25 * 1024 * 1024; // 25 MiB

	for (const file of files) {
		const filePath = path.join(absoluteDirectory, file);
		const content = await fs.readFile(filePath);

		// Validate individual asset file size
		if (content.length > MAX_ASSET_SIZE) {
			throw new Error(
				`Asset file '${file}' is too large: ${content.length} bytes (${(content.length / 1024 / 1024).toFixed(
					2,
				)} MiB). Maximum allowed is ${MAX_ASSET_SIZE} bytes (25 MiB).`,
			);
		}

		const pathname = '/' + file.replaceAll('\\', '/'); // Normalize path separators
		const contentType = mime.lookup(file) || 'application/octet-stream';

		assets.push({
			pathname,
			content: content.toString('base64'),
			contentType,
		});
	}

	return assets;
}

/**
 * Load server code modules from directory
 * @param {string} directory - Directory containing modules
 * @param {string} entrypoint - Main entry point file
 * @returns {Promise<Object>} Server code configuration
 */
export async function loadServerCode(directory, entrypoint, compatibilityDate = '2025-11-09') {
	const absoluteDirectory = path.resolve(directory);

	// Ensure directory exists
	try {
		await fs.access(absoluteDirectory);
	} catch {
		throw new Error(`Server code directory not found: ${absoluteDirectory}`);
	}

	// Scan all JavaScript/TypeScript/Python files and other module types
	const files = await glob(['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.py', '**/*.json', '**/*.txt', '**/*.html', '**/*.bin', '**/*.wasm'], {
		cwd: absoluteDirectory,
		nodir: true,
		dot: false,
	});

	const modules = {};
	const MAX_TOTAL_SERVER_CODE_SIZE = 10 * 1024 * 1024; // 10 MB
	let totalSize = 0;

	for (const file of files) {
		const filePath = path.join(absoluteDirectory, file);
		const content = await fs.readFile(filePath);
		const moduleName = file.replaceAll('\\', '/'); // Normalize path separators

		// Track total server code size
		totalSize += content.length;

		// Determine module type from extension
		const extension = path.extname(file).toLowerCase();
		let moduleType;

		switch (extension) {
			case '.js':
			case '.mjs': {
				moduleType = 'js';
				break;
			}
			case '.cjs': {
				moduleType = 'cjs';
				break;
			}
			case '.py': {
				moduleType = 'py';
				break;
			}
			case '.json': {
				moduleType = 'json';
				break;
			}
			case '.txt':
			case '.html': {
				moduleType = 'text';
				break;
			}
			case '.bin': {
				moduleType = 'data';
				break;
			}
			case '.wasm': {
				moduleType = 'wasm';
				break;
			}
		}

		if (moduleType) {
			modules[moduleName] = {
				content: content.toString('base64'),
				type: moduleType,
			};
		}
	}

	// Validate total server code size
	if (totalSize > MAX_TOTAL_SERVER_CODE_SIZE) {
		throw new Error(
			`Total server code size is too large: ${totalSize} bytes (${(totalSize / 1024 / 1024).toFixed(
				2,
			)} MB). Maximum allowed is ${MAX_TOTAL_SERVER_CODE_SIZE} bytes (10 MB).`,
		);
	}

	// Verify entrypoint exists
	if (!modules[entrypoint]) {
		throw new Error(`Entrypoint module not found: ${entrypoint} in ${absoluteDirectory}`);
	}

	return {
		entrypoint,
		modules,
		compatibilityDate,
	};
}

/**
 * Calculate SHA-256 hash of content
 * @param {Buffer|string} content - Content to hash
 * @returns {string} Hex-encoded hash
 */
export function calculateHash(content) {
	const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Create asset manifest with hashes
 * @param {Array<Object>} assets - Array of asset objects
 * @returns {Object} Manifest object
 */
export function createManifest(assets) {
	const manifest = {};
	for (const asset of assets) {
		const content = Buffer.from(asset.content, 'base64');
		const hash = calculateHash(content);
		manifest[asset.pathname] = {
			hash,
			size: content.length,
		};
	}
	return manifest;
}

/**
 * Format file size for display
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
export function formatSize(bytes) {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KiB', 'MiB', 'GiB'];
	const index = Math.floor(Math.log(bytes) / Math.log(k));
	return Math.round((bytes / Math.pow(k, index)) * 100) / 100 + ' ' + sizes[index];
}
