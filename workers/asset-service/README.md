# Asset Service Worker

The Asset Service worker is an RPC service that handles all static asset storage and serving for the platform. It's called by the orchestrator worker via Cloudflare Service Bindings.

## Architecture

### Components

- **`AssetApi`** - Main WorkerEntrypoint exposing RPC methods for asset operations
- **Binary Manifest** - Efficient binary format for storing path-to-hash mappings
- **Content-addressed Storage** - Assets stored by content hash for deduplication

### Storage

The Asset Service worker manages one KV namespace:

**`KV_ASSETS`** - All project assets and manifests

- Assets: `projectId:contentHash` (SHA-256 hash of content)
- Manifest: `projectId:ASSETS_MANIFEST` (binary manifest file)

All keys are namespaced by `projectId` to ensure complete project isolation.

## Asset Configuration

The Asset API supports advanced configuration options:

### HTML Handling

- `auto-trailing-slash` (default) - Automatically add/remove trailing slashes
- `force-trailing-slash` - Always add trailing slash
- `drop-trailing-slash` - Always remove trailing slash
- `none` - No trailing slash handling

### Not Found Handling

- `single-page-application` - Serve `/index.html` for 404s
- `404-page` - Serve `/404.html` if available
- `none` (default) - Return 404 response

### Redirects

Static and dynamic redirect rules with status codes 301, 302, 303, 307, 308.

**Limits:**

- Static redirects: Maximum 2,000 rules per project
- Dynamic redirects: Maximum 100 rules per project

### Headers

Custom headers per pathname pattern using glob syntax.

## Binary Manifest Format

Assets are stored in an efficient binary format:

- **Header:** 16 bytes (reserved)
- **Entries:** 48 bytes each
  - Path hash: 16 bytes (first 128 bits of SHA-256 of pathname)
  - Content hash: 32 bytes (SHA-256 of content)
- **Sorted:** Entries sorted by path hash for binary search

This allows fast lookups with minimal memory usage.

## Content Addressing

Assets are stored by their SHA-256 content hash, enabling:

- **Deduplication** - Same content across projects stored once
- **Cache optimization** - Unchanged assets don't need re-upload
- **Integrity** - Content hash verifies asset hasn't changed

## Security

- All operations require `projectId` parameter (enforced at type level)
- Project isolation via namespace prefixes (`projectId:*`)
- Content hash validation during upload
- Pathname validation (must start with `/`, no invalid characters)

## Development

### Commands

```bash
# Run tests
npm test

# Deploy to Cloudflare
npm run deploy

# Generate TypeScript types
npm run cf-typegen
```

### Configuration

Configure in `wrangler.jsonc`:

```jsonc
{
 "name": "asset-worker-asset-service",
 "main": "src/worker.ts",
 "compatibility_date": "2025-11-11",
 "compatibility_flags": ["nodejs_compat"],
 "kv_namespaces": [
  {
   "binding": "KV_ASSETS",
   // id: "your-kv-namespace-id"
  },
 ],
}
```

## License

MIT
