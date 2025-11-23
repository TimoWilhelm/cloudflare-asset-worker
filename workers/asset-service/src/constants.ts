// have the browser check in with the server to make sure its local cache is valid before using it
export const CACHE_CONTROL_BROWSER = 'public, max-age=0, must-revalidate';

// Asset manifest constants
export const HEADER_SIZE = 16;
export const ENTRY_SIZE = 48;
export const PATH_HASH_OFFSET = 0;
export const PATH_HASH_SIZE = 16;
export const CONTENT_HASH_OFFSET = 16;
export const CONTENT_HASH_SIZE = 32;
