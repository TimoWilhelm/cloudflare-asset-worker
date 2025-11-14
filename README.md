# Cloudflare Asset Worker

A Cloudflare Worker for serving static assets from KV storage with advanced routing, redirects, and custom header support.

## Overview

This worker implements a flexible static asset serving system that stores assets in Cloudflare KV and provides intelligent HTML routing, custom redirects, and header management. It's designed as a `WorkerEntrypoint` to support RPC calls for asset operations.

## Features

- 🗂️ **Static Asset Serving** - Serve files from Cloudflare KV with content-type detection and ETags
- 🔀 **HTML Routing Strategies** - Multiple strategies for handling HTML files and trailing slashes
- ↪️ **Redirects** - Static and dynamic redirect rules with multiple HTTP status codes
- 📋 **Custom Headers** - Configure custom headers per path or globally
- 🔍 **Not Found Handling** - Support for 404 pages and SPA mode
- ⚡ **RPC Methods** - Expose worker methods for programmatic access
- 🧪 **Comprehensive Tests** - Full test coverage with Vitest

## Installation

```bash
npm install
```

## Configuration

### wrangler.jsonc

Configure your worker in `wrangler.jsonc`:

```jsonc
{
  "name": "asset-worker",
  "main": "src/worker.ts",
  "compatibility_date": "2024-07-31",
  "compatibility_flags": ["nodejs_compat"],

  "kv_namespaces": [
    {
      "binding": "ASSETS_KV_NAMESPACE",
      "id": "your-kv-namespace-id"
    }
  ],

  "version_metadata": {
    "binding": "VERSION_METADATA"
  },

  "vars": {
    "ENVIRONMENT": "production",
    "CONFIG": {
      // Configuration options (see below)
    }
  }
}
```

### Worker Configuration

The `CONFIG` object supports the following options:

#### HTML Handling

Controls how HTML files are served and how trailing slashes are handled:

- **`auto-trailing-slash`** (default) - Automatically detects whether to use trailing slashes
- **`force-trailing-slash`** - Forces all HTML paths to end with `/`
- **`drop-trailing-slash`** - Removes trailing slashes from HTML paths
- **`none`** - No special HTML handling, exact path matching only

```jsonc
"CONFIG": {
  "html_handling": "auto-trailing-slash"
}
```

#### Not Found Handling

Controls behavior when assets are not found:

- **`none`** (default) - Return no intent (let other handlers deal with it)
- **`404-page`** - Serve a custom `404.html` from the nearest parent directory
- **`single-page-application`** - Always serve `/index.html` for non-existent routes

```jsonc
"CONFIG": {
  "not_found_handling": "single-page-application"
}
```

#### Redirects

Configure URL redirects with status codes:

```jsonc
"CONFIG": {
  "redirects": {
    "version": 1,
    "staticRules": {
      "/old-path": { "to": "/new-path", "status": 301 }
    },
    "rules": {
      // Dynamic redirect rules
    }
  }
}
```

Supported redirect status codes:

- `200` - Proxy/rewrite (transparent, no redirect)
- `301` - Moved Permanently
- `302` - Found (temporary redirect)
- `303` - See Other
- `307` - Temporary Redirect
- `308` - Permanent Redirect

#### Custom Headers

Add custom headers to responses:

```jsonc
"CONFIG": {
  "headers": {
    "version": 2,
    "rules": {
      "/*": {
        "X-Custom-Header": "value"
      }
    }
  }
}
```

#### Other Options

```jsonc
"CONFIG": {
  "has_static_routing": false,  // Enable static routing optimization
  "debug": false                 // Enable debug mode
}
```

## Setup

### 1. Create a KV Namespace

```bash
wrangler kv namespace create ASSETS_KV_NAMESPACE
```

Update the `kv_namespaces` binding in `wrangler.jsonc` with the returned ID.

### 2. Upload Assets to KV

Assets should be uploaded to KV with their ETag as the key and the file content as the value. Include metadata with the content type:

```typescript
await env.ASSETS_KV_NAMESPACE.put(eTag, fileContent, {
  metadata: { contentType: "text/html" }
});
```

### 3. Generate and Configure Assets Manifest

Create a base64-encoded assets manifest that maps pathnames to ETags:

```typescript
const manifest = new AssetsManifest(manifestBuffer);
```

## Usage

### Development

Start the development server:

```bash
npm run dev
```

### Testing

Run the test suite:

```bash
npm test
```

### Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

## RPC Methods

The worker exposes the following public methods via RPC:

### `canFetch(request: Request): Promise<boolean>`

Check if the worker can handle a given request.

```typescript
const canHandle = await assetWorker.canFetch(request);
```

### `exists(pathname: string, request?: Request): Promise<string | null>`

Check if an asset exists at the given pathname. Returns the ETag if found, null otherwise.

```typescript
const eTag = await assetWorker.exists("/index.html");
```

### `getByETag(eTag: string, request?: Request): Promise<Asset>`

Fetch an asset by its ETag.

```typescript
const asset = await assetWorker.getByETag(eTag);
// Returns: { readableStream, contentType, cacheStatus }
```

### `getByPathname(pathname: string, request?: Request): Promise<Asset | null>`

Fetch an asset by its pathname.

```typescript
const asset = await assetWorker.getByPathname("/index.html");
// Returns: { readableStream, contentType, cacheStatus } or null
```

## Architecture

### Core Components

- **`src/worker.ts`** - Main worker entrypoint with RPC methods
- **`src/handler.ts`** - Request handling logic and routing
- **`src/configuration.ts`** - Configuration normalization
- **`src/assets-manifest.ts`** - Asset manifest management
- **`src/utils/`** - Utility functions for headers, KV, redirects, etc.

### Request Flow

1. **Request Reception** - Worker receives an HTTP request
2. **Configuration Loading** - Load and normalize configuration
3. **Redirect Processing** - Check for static or dynamic redirects
4. **Path Decoding** - Decode URL paths for non-ASCII character support
5. **Asset Resolution** - Determine which asset to serve based on HTML handling rules
6. **ETag Validation** - Check `If-None-Match` header for 304 responses
7. **Asset Fetching** - Retrieve asset from KV by ETag
8. **Header Application** - Apply custom headers and content-type
9. **Response** - Return the final response

## Performance

- **KV Cache Detection** - Automatically detects KV cache hits (< 100ms fetch time)
- **ETag Support** - Efficient caching with strong and weak ETags
- **304 Not Modified** - Saves bandwidth with conditional requests
- **Lazy Manifest Loading** - Assets manifest is loaded only when needed

## Test Suite

The project includes comprehensive tests:

- `tests/handler.test.ts` - Request handler tests
- `tests/assets-manifest.test.ts` - Manifest parsing tests
- `tests/kv.test.ts` - KV operations tests
- `tests/rules-engine.test.ts` - Redirect and header rules tests

## License

MIT

## Author

[Your name or organization]
