import { CONTENT_HASH_OFFSET, CONTENT_HASH_SIZE, ENTRY_SIZE, HEADER_SIZE, PATH_HASH_OFFSET, PATH_HASH_SIZE } from './constants';

export class AssetsManifest {
	constructor(private readonly data: Uint8Array) {}

	async get(pathname: string) {
		const pathHash = await hashPath(pathname);
		const entry = binarySearch(this.data, pathHash);
		return entry ? Uint8ToHexString(entry) : undefined;
	}
}

/**
 * Computes a truncated SHA-256 hash of a pathname for manifest lookup.
 *
 * @param path - The pathname to hash
 * @returns The first PATH_HASH_SIZE bytes of the SHA-256 hash
 */
export const hashPath = async (path: string) => {
	const encoder = new TextEncoder();
	const data = encoder.encode(path);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	return new Uint8Array(hashBuffer, 0, PATH_HASH_SIZE);
};

/**
 * Searches for an entry with the given path hash using binary search.
 *
 * @param manifest - The manifest bytes
 * @param pathHash - The path hash to find in the manifest
 * @returns The content hash if found, false otherwise
 */
export const binarySearch = (manifest: Uint8Array, pathHash: Uint8Array): Uint8Array | false => {
	if (pathHash.byteLength !== PATH_HASH_SIZE) {
		throw new TypeError(`Search value should have a length of ${PATH_HASH_SIZE}`);
	}

	const numberOfEntries = (manifest.byteLength - HEADER_SIZE) / ENTRY_SIZE;

	if (numberOfEntries === 0) {
		return false;
	}

	let lowIndex = 0;
	let highIndex = numberOfEntries - 1;

	while (lowIndex <= highIndex) {
		const middleIndex = (lowIndex + highIndex) >> 1;

		const cmp = comparePathHashWithEntry(pathHash, manifest, middleIndex);

		if (cmp < 0) {
			highIndex = middleIndex - 1;
			continue;
		}

		if (cmp > 0) {
			lowIndex = middleIndex + 1;
			continue;
		}

		return new Uint8Array(manifest.buffer, HEADER_SIZE + middleIndex * ENTRY_SIZE + CONTENT_HASH_OFFSET, CONTENT_HASH_SIZE);
	}

	return false;
};

/**
 * Compares a search value with a path hash in the manifest
 *
 * @param searchValue a `Uint8Array` of size `PATH_HASH_SIZE`
 * @param manifest the manifest bytes
 * @param entryIndex the index in the manifest of the entry to compare
 */
function comparePathHashWithEntry(searchValue: Uint8Array, manifest: Uint8Array, entryIndex: number) {
	let pathHashOffset = HEADER_SIZE + entryIndex * ENTRY_SIZE + PATH_HASH_OFFSET;
	for (let offset = 0; offset < PATH_HASH_SIZE; offset++, pathHashOffset++) {
		// We know that both values could not be undefined

		const s = searchValue[offset]!;

		const entry = manifest[pathHashOffset]!;
		if (s < entry) {
			return -1;
		}
		if (s > entry) {
			return 1;
		}
	}

	return 0;
}

/**
 * Converts an Uint8Array to an hex string
 *
 * @param array The content hash
 * @returns padded hex string
 */
const Uint8ToHexString = (array: Uint8Array) => {
	return [...array].map((b) => b.toString(16).padStart(2, '0')).join('');
};
