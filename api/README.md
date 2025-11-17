# Cloudflare Asset Worker API

A Cloudflare Workers-based static asset serving API that efficiently stores and serves static files using Cloudflare KV storage.

## Overview

This project is heavily based on the [asset-worker](https://github.com/cloudflare/workers-sdk/tree/main/packages/workers-shared/asset-worker) repository from Cloudflare Workers SDK. The asset-worker is responsible for serving static assets for Cloudflare Workers, providing efficient content delivery with advanced features like HTML handling, redirects, and custom headers.

The API provides a WorkerEntrypoint (`AssetApi`) that can be called via RPC from other workers, enabling multi-tenant static asset serving with project namespacing.

## Key Features

- **Binary manifest format** for efficient asset lookup using SHA-256 hashed pathnames
- **Multi-tenant support** with project-based namespacing in KV storage
- **HTML handling modes**:
  - `auto-trailing-slash` - Automatically handle trailing slashes based on file existence
  - `force-trailing-slash` - Force all HTML pages to have trailing slashes
  - `drop-trailing-slash` - Remove trailing slashes from HTML pages
  - `none` - Serve files exactly as requested
- **Not-found handling**:
  - `single-page-application` - Serve `/index.html` for all 404s (SPA mode)
  - `404-page` - Serve nearest `/404.html` in the directory tree
  - `none` - Return 404 responses
- **Static and dynamic redirects** with support for 301, 302, 303, 307, 308 status codes
- **Custom headers** per route/pathname
- **ETag-based caching** with If-None-Match support for 304 responses
- **Content-based deduplication** - Same content is stored once even across multiple files

## Architecture

### Components

- **`AssetApi`** - Main WorkerEntrypoint class exposing RPC methods
- **Binary Manifest** - Efficient binary format for storing pathname → content hash mappings
  - 16-byte header
  - 48-byte entries: 16-byte path hash + 32-byte content hash
  - Sorted by path hash for binary search lookup
- **KV Namespaces**:
  - `MANIFEST_KV_NAMESPACE` - Stores binary manifests per project
  - `ASSETS_KV_NAMESPACE` - Stores actual asset content with content-type metadata

### RPC Methods

#### `serveAsset(request, projectId?, projectConfig?)`
Serves a static asset for a given request with optional project namespace and configuration.

#### `canFetch(request, projectId?, projectConfig?)`
Checks if an asset exists for the given request without fetching it.

#### `uploadAsset(eTag, content, contentType?, projectId?)`
Uploads an asset to KV storage with optional content type metadata.

#### `uploadManifest(entries, projectId?)`
Uploads a manifest and returns entries that need asset uploads (content deduplication).

#### `deleteProjectAssets(projectId)`
Deletes all assets and manifest for a specific project.

#### `exists(pathname, request, projectId?)`
Checks if an asset exists for a given pathname and returns its eTag.

#### `getByETag(eTag, request?, projectId?)`
Fetches an asset by its eTag (content hash) with cache status.

#### `getByPathname(pathname, request, projectId?)`
Fetches an asset by pathname (convenience method combining exists + getByETag).

## Usage

### Deploying Assets

```javascript
const assets = env.ASSET_WORKER as Service<AssetApi>;

// Upload manifest
const manifestEntries = [
  { pathname: '/index.html', contentHash: 'abc123...' },
  { pathname: '/style.css', contentHash: 'def456...' }
];

const newEntries = await assets.uploadManifest(manifestEntries, projectId);

// Upload only new assets (content deduplication)
for (const entry of newEntries) {
  await assets.uploadAsset(entry.contentHash, content, contentType, projectId);
}
```

### Serving Assets

```javascript
const assets = env.ASSET_WORKER as Service<AssetApi>;

// Check if we can serve this request
const canServe = await assets.canFetch(request, projectId, config);

if (canServe) {
  // Serve the asset
  return await assets.serveAsset(request, projectId, config);
}
```

## Configuration

See [`configuration.ts`](./src/configuration.ts) for the full `AssetConfig` interface.

Example configuration:

```typescript
const config: AssetConfig = {
  html_handling: 'auto-trailing-slash',
  not_found_handling: 'single-page-application',
  redirects: {
    version: 1,
    staticRules: {
      '/old-path': { status: 301, to: '/new-path', lineNumber: 1 }
    },
    rules: {}
  },
  headers: {
    version: 2,
    rules: {
      '/*.html': {
        set: { 'Cache-Control': 'public, max-age=3600' }
      }
    }
  }
};
```

## Development

### Commands

```bash
# Run tests
npm test

# Deploy to Cloudflare
npm run deploy

# Local development
npm run dev

# Generate TypeScript types
npm run cf-typegen

# Regenerate test fixtures
npm run generate-fixtures
```

### Testing

Tests are located in [`tests/`](./tests/) and use Vitest with Cloudflare's Vitest pool workers:

```bash
npm test
```

## Technical Details

### Binary Manifest Format

The manifest uses a custom binary format for space efficiency and fast lookups:

- **Header**: 16 bytes (reserved for metadata)
- **Entries**: Each entry is 48 bytes:
  - 16 bytes: SHA-256 hash of pathname (first 128 bits)
  - 32 bytes: SHA-256 hash of content (full 256 bits)
- Entries are sorted by path hash for binary search

### Content Addressing

Assets are stored by their SHA-256 content hash (eTag), enabling:
- **Deduplication**: Same content stored once even if used in multiple files
- **Immutability**: Content never changes for a given hash
- **Cache-friendly**: ETags enable efficient HTTP caching

### Project Namespacing

All KV keys are prefixed with `{projectId}:` to enable multi-tenant isolation:
- Manifest: `{projectId}:ASSETS_MANIFEST`
- Assets: `{projectId}:{contentHash}`

## License

MIT
