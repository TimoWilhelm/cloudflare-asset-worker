import { writeFileSync } from 'node:fs';
import path from 'node:path';

const HEADER_SIZE = 16;
const ENTRY_SIZE = 48;
const PATH_HASH_OFFSET = 0;
const PATH_HASH_SIZE = 16;
const CONTENT_HASH_OFFSET = 16;

const encoder = new TextEncoder();

async function SHA_256(value: string, length: number) {
	const data = encoder.encode(value);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
	return new Uint8Array(hashBuffer, 0, length);
}

function hexToBytes(hex: string) {
	if (!/^([0-9a-f]{2})+$/gi.test(hex)) {
		throw new TypeError(`Invalid byte string:  ${hex}`);
	}

	return new Uint8Array(hex.match(/[0-9a-f]{2}/gi)?.map((b) => Number.parseInt(b, 16)) ?? []);
}

function compare(a: Uint8Array, b: Uint8Array) {
	if (a.byteLength < b.byteLength) {
		return -1;
	}
	if (a.byteLength > b.byteLength) {
		return 1;
	}

	for (const [index, element] of a.entries()) {
		const v = element as number;
		const bValue = b[index] as number;
		if (v < bValue) {
			return -1;
		}
		if (v > bValue) {
			return 1;
		}
	}

	return 0;
}

const encode = async (assetEntries: { path: string; contentHash: string }[]) => {
	const entries = await Promise.all(
		assetEntries.map(async (entry) => ({
			path: entry.path,
			contentHash: entry.contentHash,
			pathHashBytes: await SHA_256(entry.path, PATH_HASH_SIZE),
		})),
	);
	entries.sort((a, b) => compare(a.pathHashBytes, b.pathHashBytes));

	const assetManifestBytes = new Uint8Array(HEADER_SIZE + entries.length * ENTRY_SIZE);

	for (const [index, entry] of entries.entries()) {
		const { pathHashBytes, contentHash } = entry as { path: string; contentHash: string; pathHashBytes: Uint8Array };
		const contentHashBytes = hexToBytes(contentHash);
		const entryOffset = HEADER_SIZE + index * ENTRY_SIZE;

		assetManifestBytes.set(pathHashBytes, entryOffset + PATH_HASH_OFFSET);
		assetManifestBytes.set(contentHashBytes, entryOffset + CONTENT_HASH_OFFSET);
	}

	return assetManifestBytes.buffer;
};

// Generate the fixture
async function main() {
	const fixture = await encode([
		{
			path: '/path1',
			contentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
		},
		{
			path: '/path2',
			contentHash: '1123456789abcdef0123456789abcdef1123456789abcdef0123456789abcdef',
		},
		{
			path: '/path3',
			contentHash: 'ABCDEF01231230123131231FDFFEDFDFABCDEF01231230123131231FDFFEDFDF',
		},
	]);

	const outputPath = path.resolve(process.cwd(), 'tests/fixtures', 'AssetManifest.bin');
	writeFileSync(outputPath, new Uint8Array(fixture));
	console.log(`Fixture regenerated at ${outputPath}`);
}

await main();
