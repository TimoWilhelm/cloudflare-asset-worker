import type { ModuleType } from './types';

/**
 * Computes the SHA-256 content hash of the given data.
 *
 * @param content - The content to hash as an ArrayBuffer or ArrayBufferView
 * @returns The SHA-256 hash as a lowercase hexadecimal string
 */
export async function computeContentHash(content: ArrayBuffer | ArrayBufferView): Promise<string> {
	const contentHashBuffer = await crypto.subtle.digest('SHA-256', content);
	const contentHash = [...new Uint8Array(contentHashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return contentHash;
}

/**
 * Guesses the MIME content type from a file pathname based on extension.
 *
 * @param pathname - The file path or name to analyze
 * @returns The MIME type string or undefined if the extension is not recognized
 */
export function guessContentType(pathname: string): string | undefined {
	const extension = pathname.split('.').pop()?.toLowerCase();
	const contentTypes: Record<string, string> = {
		html: 'text/html',
		css: 'text/css',
		js: 'application/javascript',
		json: 'application/json',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		svg: 'image/svg+xml',
		webp: 'image/webp',
		xml: 'application/xml',
		pdf: 'application/pdf',
		zip: 'application/zip',
		txt: 'text/plain',
		md: 'text/markdown',
		woff: 'font/woff',
		woff2: 'font/woff2',
		ttf: 'font/ttf',
		eot: 'application/vnd.ms-fontobject',
		otf: 'font/otf',
	};
	return extension ? contentTypes[extension] : undefined;
}

/**
 * Infers the module type from a file extension for server-side code deployment.
 *
 * @param modulePath - The module file path to analyze
 * @returns The inferred module type (defaults to 'js' for unknown extensions)
 */
export function inferModuleType(modulePath: string): ModuleType {
	const extension = modulePath.split('.').pop()?.toLowerCase();
	switch (extension) {
		case 'js':
		case 'mjs': {
			return 'js';
		}
		case 'cjs': {
			return 'cjs';
		}
		case 'py': {
			return 'py';
		}
		case 'txt': {
			return 'text';
		}
		case 'html': {
			return 'text';
		}
		case 'json': {
			return 'json';
		}
		case 'bin': {
			return 'data';
		}
		case 'wasm': {
			return 'wasm';
		}
		default: {
			return 'js';
		} // Default to ES modules
	}
}

/**
 * Creates buckets of hashes for optimal batch uploading.
 *
 * @param hashes - Array of content hashes to organize into buckets
 * @param maxPerBucket - Maximum number of hashes per bucket (default: 10)
 * @returns Array of buckets, each containing up to maxPerBucket hashes
 */
export function createBuckets(hashes: string[], maxPerBucket: number = 10): string[][] {
	const buckets: string[][] = [];
	for (let index = 0; index < hashes.length; index += maxPerBucket) {
		buckets.push(hashes.slice(index, index + maxPerBucket));
	}
	return buckets;
}
