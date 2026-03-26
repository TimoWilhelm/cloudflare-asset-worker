/**
 * Minimal MIME type lookup for static asset serving.
 *
 * @param path - The file path or name
 * @returns The MIME type string, or `application/octet-stream` for unknown extensions
 */
export function getMimeType(path: string): string {
	const extension = path.split('.').pop()?.toLowerCase() ?? '';
	return MIME_TYPES[extension] ?? 'application/octet-stream';
}

const MIME_TYPES: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	htm: 'text/html; charset=utf-8',
	css: 'text/css; charset=utf-8',
	js: 'application/javascript; charset=utf-8',
	mjs: 'application/javascript; charset=utf-8',
	json: 'application/json; charset=utf-8',
	xml: 'application/xml; charset=utf-8',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	ico: 'image/x-icon',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	eot: 'application/vnd.ms-fontobject',
	txt: 'text/plain; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	pdf: 'application/pdf',
	zip: 'application/zip',
	gz: 'application/gzip',
	wasm: 'application/wasm',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	webm: 'video/webm',
	ogg: 'audio/ogg',
	wav: 'audio/wav',
	map: 'application/json',
	webmanifest: 'application/manifest+json',
};
