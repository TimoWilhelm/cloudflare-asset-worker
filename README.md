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
bun run dev  # Development
# or deploy to production using wrangler deploy
```

### Dev Mode: Deploy the Fullstack Example (Step-by-Step)

1. Create a dev vars file for the router worker:

   Create `workers/router/.dev.vars`:

   ```text
   API_TOKEN=dev-token
   JWT_SECRET=dev-jwt-secret
   ```

2. Install dependencies from the repository root:

   ```bash
   bun install
   ```

3. Start the platform locally (router + asset-service):

   ```bash
   bun run dev
   ```

   The router will be available at:

   ```text
   http://127.0.0.1:8787
   ```

4. Link the CLI binary (`cf-deploy`) so it’s available on your PATH:

   ```bash
   cd cli
   bun link
   ```

5. Deploy the fullstack example to the local dev router (use flags for auth):

   ```bash
   cd examples/fullstack-app
   cf-deploy deploy --api-token dev-token --router-url http://127.0.0.1:8787
   ```

6. Open the deployed app using path-based routing (dev mode):

   The CLI prints a URL like:

   ```text
   http://127.0.0.1:8787/__project/<projectId>/
   ```

7. Verify it works:
   - Click “Test API” to call `/api/hello`
   - Click “Show Config” to call `/api/config`

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
