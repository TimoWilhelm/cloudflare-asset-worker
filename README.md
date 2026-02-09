# Cloudflare Multi-Project Deployment Platform

A Cloudflare Workers-based platform for hosting multiple projects with static assets and optional server-side code. Deploy and manage isolated projects using content-addressed storage with automatic deduplication.

## Features

- **Multi-project hosting** - Host unlimited isolated projects on a single Worker deployment
- **Content-addressed storage** - Automatic deduplication across projects using SHA-256 hashing
- **Dynamic worker code** - Optional server-side JavaScript/Python with full Workers API access
- **Efficient uploads** - Three-phase upload flow with automatic deduplication and batching
- **Flexible routing** - Assets-first or worker-first request handling with glob pattern matching
- **Advanced configuration** - SPA support, custom redirects, headers, and trailing slash handling

## Architecture

The platform consists of two Workers:

- **[Router Worker](./workers/router/)** - Handles routing, project management, and deployment API
- **[Asset Service Worker](./workers/asset-service/)** - Handles asset storage and serving via RPC Service Binding

Both workers use KV namespaces for storage with content-addressing for optimal deduplication.

## Quick Start

### Deploy the Workers

```bash
# Deploy both workers
npm run dev  # Development
# or deploy to production using wrangler deploy
```

### Use the Platform

See **[examples/](./examples/)** for deployment scripts demonstrating:

- Static site deployment
- Full-stack apps with server-side code
- Three-phase upload automation

## URL Schemes

**Subdomain-based** (recommended):

```text
https://project-id.yourdomain.com/path
```

**Path-based** (development):

```text
https://yourdomain.com/__project/project-id/path
```

## Learn More

- **[Router Worker Documentation](./workers/router/README.md)** - Project management, routing, and deployment API
- **[Asset Service Worker Documentation](./workers/asset-service/README.md)** - Asset storage, serving, and RPC methods
- **[Deployment Examples](./examples/README.md)** - Ready-to-use deployment scripts
- **[Analytics](./ANALYTICS.md)** - Learn how to query your Workers Analytics Engine data

## License

MIT
