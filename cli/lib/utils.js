import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import mime from 'mime-types';

/**
 * Load and parse configuration file
 * @param {string} configPath - Path to config file
 * @returns {Promise<Object>} Parsed configuration
 */
export async function loadConfig(configPath) {
	const configContent = await fs.readFile(configPath, 'utf-8');
	const config = JSON.parse(configContent);

	// Replace environment variable placeholders in env section (optional substitution)
	// This allows ${VAR} syntax in the env section to reference local environment variables
	if (config.env) {
		const envStr = JSON.stringify(config.env);
		const replacedStr = envStr.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
			const value = process.env[envVar];
			// Keep original if not found (don't throw error)
			return value !== undefined ? value : match;
		});
		config.env = JSON.parse(replacedStr);
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
	const absoluteDir = path.resolve(directory);

	// Ensure directory exists
	try {
		await fs.access(absoluteDir);
	} catch (error) {
		throw new Error(`Assets directory not found: ${absoluteDir}`);
	}

	// Scan files using glob patterns
	const files = await glob(patterns, {
		cwd: absoluteDir,
		ignore,
		nodir: true,
		dot: false,
	});

	for (const file of files) {
		const filePath = path.join(absoluteDir, file);
		const content = await fs.readFile(filePath);
		const pathname = '/' + file.replace(/\\/g, '/'); // Normalize path separators
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
	const absoluteDir = path.resolve(directory);

	// Ensure directory exists
	try {
		await fs.access(absoluteDir);
	} catch (error) {
		throw new Error(`Server code directory not found: ${absoluteDir}`);
	}

	// Scan all JavaScript/TypeScript/Python files
	const files = await glob(['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.py', '**/*.json', '**/*.txt'], {
		cwd: absoluteDir,
		nodir: true,
		dot: false,
	});

	const modules = {};

	for (const file of files) {
		const filePath = path.join(absoluteDir, file);
		const content = await fs.readFile(filePath);
		const moduleName = file.replace(/\\/g, '/'); // Normalize path separators

		// Determine module type from extension
		const ext = path.extname(file).toLowerCase();
		let moduleType = null;

		switch (ext) {
			case '.js':
			case '.mjs':
				moduleType = 'js';
				break;
			case '.cjs':
				moduleType = 'cjs';
				break;
			case '.py':
				moduleType = 'py';
				break;
			case '.json':
				moduleType = 'json';
				break;
			case '.txt':
				moduleType = 'text';
				break;
		}

		if (moduleType) {
			modules[moduleName] = {
				content: content.toString('base64'),
				type: moduleType,
			};
		}
	}

	// Verify entrypoint exists
	if (!modules[entrypoint]) {
		throw new Error(`Entrypoint module not found: ${entrypoint} in ${absoluteDir}`);
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
	const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
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
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
