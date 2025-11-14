# Cloudflare Asset Worker

> **⚠️ Experimental Project** - This is an experimental project and is under active development. APIs and behavior may change without notice.

A Cloudflare Worker system for serving static assets from KV storage with advanced routing, redirects, and custom header support.

This project is heavily based on the [asset-worker](https://github.com/cloudflare/workers-sdk/tree/main/packages/workers-shared/asset-worker) that powers Cloudflare's static asset serving, but avoids using any internal bindings to remain portable and customizable.

## Project Structure

This repository contains two independent workers:

- **`api/`** - The main asset serving worker that stores assets in KV and handles requests with configurable routing, redirects, and headers. Exposes RPC methods for programmatic asset operations.
- **`manager/`** - A separate worker for managing asset uploads and manifest generation.

## Features

- Static asset serving from Cloudflare KV with content-type detection and ETags
- Configurable HTML routing strategies (trailing slash handling, SPA mode)
- Static and dynamic redirects with multiple HTTP status codes
- Custom header configuration per path or globally
- RPC methods for programmatic access
- 304 Not Modified responses for efficient caching

## Configuration

Configure the worker via `wrangler.jsonc` in the `api/` directory:

```jsonc
{
  "vars": {
    "CONFIG": {
      "html_handling": "auto-trailing-slash",
      "not_found_handling": "single-page-application",
      "redirects": {
        "version": 1,
        "staticRules": {
          "/old": { "to": "/new", "status": 301 }
        }
      },
      "headers": {
        "version": 2,
        "rules": {
          "/*": { "X-Custom-Header": "value" }
        }
      }
    }
  }
}
```

### HTML Handling

- `auto-trailing-slash` - Automatically detects trailing slash usage
- `force-trailing-slash` - Forces all HTML paths to end with `/`
- `drop-trailing-slash` - Removes trailing slashes
- `none` - Exact path matching only

### Not Found Handling

- `none` - Return no intent (default)
- `404-page` - Serve custom `404.html` from nearest parent directory
- `single-page-application` - Always serve `/index.html` for missing routes

### Redirects

Supports status codes: `200` (proxy), `301`, `302`, `303`, `307`, `308`

## RPC Methods

The worker exposes public methods via RPC:

- `canFetch(request)` - Check if worker can handle a request
- `exists(pathname)` - Check if asset exists, returns ETag or null
- `getByETag(eTag)` - Fetch asset by ETag
- `getByPathname(pathname)` - Fetch asset by pathname

## Asset Storage

Assets are stored in KV with ETags as keys. The asset manifest maps pathnames to ETags and is loaded on-demand. Assets include content-type metadata and support conditional requests via ETags.

## License

MIT
