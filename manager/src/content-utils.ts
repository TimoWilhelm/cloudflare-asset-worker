import type { ModuleType } from './types';

/**
 * Compute SHA-256 content hash
 */
export async function computeContentHash(content: ArrayBuffer | ArrayBufferView): Promise<string> {
	const contentHashBuffer = await crypto.subtle.digest('SHA-256', content);
	const contentHash = Array.from(new Uint8Array(contentHashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return contentHash;
}

/**
 * Guess content type from pathname
 */
export function guessContentType(pathname: string): string | undefined {
	const ext = pathname.split('.').pop()?.toLowerCase();
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
	return ext ? contentTypes[ext] : undefined;
}

/**
 * Infer module type from file extension
 */
export function inferModuleType(modulePath: string): ModuleType {
	const ext = modulePath.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'js':
		case 'mjs':
			return 'js';
		case 'cjs':
			return 'cjs';
		case 'py':
			return 'py';
		case 'txt':
			return 'text';
		case 'json':
			return 'json';
		default:
			return 'js'; // Default to ES modules
	}
}

/**
 * Create buckets for optimal batch uploading
 */
export function createBuckets(hashes: string[], maxPerBucket: number = 10): string[][] {
	const buckets: string[][] = [];
	for (let i = 0; i < hashes.length; i += maxPerBucket) {
		buckets.push(hashes.slice(i, i + maxPerBucket));
	}
	return buckets;
}
