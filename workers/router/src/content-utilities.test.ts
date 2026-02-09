import { computeContentHash, guessContentType, inferModuleType, createBuckets } from './content-utilities';

describe('content-utilities', () => {
	describe('computeContentHash', () => {
		it('computes SHA-256 hash from ArrayBuffer', async () => {
			const content = new TextEncoder().encode('Hello, World!');
			const hash = await computeContentHash(content);

			// Expected SHA-256 hash of "Hello, World!"
			expect(hash).toBe('dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f');
			expect(hash).toHaveLength(64);
		});

		it('computes same hash for same content', async () => {
			const content1 = new TextEncoder().encode('test content');
			const content2 = new TextEncoder().encode('test content');

			const hash1 = await computeContentHash(content1);
			const hash2 = await computeContentHash(content2);

			expect(hash1).toBe(hash2);
		});

		it('computes different hashes for different content', async () => {
			const content1 = new TextEncoder().encode('content A');
			const content2 = new TextEncoder().encode('content B');

			const hash1 = await computeContentHash(content1);
			const hash2 = await computeContentHash(content2);

			expect(hash1).not.toBe(hash2);
		});

		it('handles empty content', async () => {
			const content = new TextEncoder().encode('');
			const hash = await computeContentHash(content);

			// SHA-256 hash of empty string
			expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		});
	});

	describe('guessContentType', () => {
		it('returns correct content type for common extensions', () => {
			expect(guessContentType('index.html')).toBe('text/html');
			expect(guessContentType('styles.css')).toBe('text/css');
			expect(guessContentType('script.js')).toBe('application/javascript');
			expect(guessContentType('data.json')).toBe('application/json');
			expect(guessContentType('image.png')).toBe('image/png');
			expect(guessContentType('photo.jpg')).toBe('image/jpeg');
			expect(guessContentType('photo.jpeg')).toBe('image/jpeg');
			expect(guessContentType('icon.svg')).toBe('image/svg+xml');
		});

		it('returns correct content type for font files', () => {
			expect(guessContentType('font.woff')).toBe('font/woff');
			expect(guessContentType('font.woff2')).toBe('font/woff2');
			expect(guessContentType('font.ttf')).toBe('font/ttf');
			expect(guessContentType('font.otf')).toBe('font/otf');
		});

		it('handles paths with directories', () => {
			expect(guessContentType('/assets/images/logo.png')).toBe('image/png');
			expect(guessContentType('/css/main.css')).toBe('text/css');
		});

		it('is case insensitive', () => {
			expect(guessContentType('file.HTML')).toBe('text/html');
			expect(guessContentType('file.PNG')).toBe('image/png');
			expect(guessContentType('file.CSS')).toBe('text/css');
		});

		it('returns undefined for unknown extensions', () => {
			expect(guessContentType('file.xyz')).toBeUndefined();
			expect(guessContentType('file.unknown')).toBeUndefined();
		});

		it('returns undefined for files without extension', () => {
			expect(guessContentType('README')).toBeUndefined();
			expect(guessContentType('/path/to/file')).toBeUndefined();
		});
	});

	describe('inferModuleType', () => {
		it('infers js module type', () => {
			expect(inferModuleType('index.js')).toBe('js');
			expect(inferModuleType('module.mjs')).toBe('js');
		});

		it('infers cjs module type', () => {
			expect(inferModuleType('module.cjs')).toBe('cjs');
		});

		it('infers python module type', () => {
			expect(inferModuleType('script.py')).toBe('py');
		});

		it('infers text module type', () => {
			expect(inferModuleType('file.txt')).toBe('text');
		});

		it('infers json module type', () => {
			expect(inferModuleType('config.json')).toBe('json');
		});

		it('defaults to js for unknown extensions', () => {
			expect(inferModuleType('file.xyz')).toBe('js');
			expect(inferModuleType('file.ts')).toBe('js');
			expect(inferModuleType('file')).toBe('js');
		});

		it('handles paths with directories', () => {
			expect(inferModuleType('/src/modules/worker.js')).toBe('js');
			expect(inferModuleType('/lib/helper.py')).toBe('py');
		});

		it('is case insensitive', () => {
			expect(inferModuleType('FILE.JS')).toBe('js');
			expect(inferModuleType('FILE.PY')).toBe('py');
		});
	});

	describe('createBuckets', () => {
		it('creates buckets with default size of 10', () => {
			const hashes = Array.from({ length: 25 }, (_, index) => `hash${index}`);
			const buckets = createBuckets(hashes);

			expect(buckets).toHaveLength(3);
			expect(buckets[0]).toHaveLength(10);
			expect(buckets[1]).toHaveLength(10);
			expect(buckets[2]).toHaveLength(5);
		});

		it('creates buckets with custom size', () => {
			const hashes = Array.from({ length: 13 }, (_, index) => `hash${index}`);
			const buckets = createBuckets(hashes, 5);

			expect(buckets).toHaveLength(3);
			expect(buckets[0]).toHaveLength(5);
			expect(buckets[1]).toHaveLength(5);
			expect(buckets[2]).toHaveLength(3);
		});

		it('handles empty array', () => {
			const buckets = createBuckets([]);
			expect(buckets).toHaveLength(0);
		});

		it('handles single item', () => {
			const buckets = createBuckets(['hash1']);
			expect(buckets).toHaveLength(1);
			expect(buckets[0]).toEqual(['hash1']);
		});

		it('handles exact multiple of bucket size', () => {
			const hashes = Array.from({ length: 20 }, (_, index) => `hash${index}`);
			const buckets = createBuckets(hashes, 10);

			expect(buckets).toHaveLength(2);
			expect(buckets[0]).toHaveLength(10);
			expect(buckets[1]).toHaveLength(10);
		});

		it('preserves hash order', () => {
			const hashes = ['hash1', 'hash2', 'hash3', 'hash4', 'hash5'];
			const buckets = createBuckets(hashes, 2);

			expect(buckets[0]).toEqual(['hash1', 'hash2']);
			expect(buckets[1]).toEqual(['hash3', 'hash4']);
			expect(buckets[2]).toEqual(['hash5']);
		});
	});
});
