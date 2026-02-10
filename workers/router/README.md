# Router Worker

The router worker is the main router for the Cloudflare Multi-Project Deployment Platform. It handles project management, asset uploads, deployment, and dynamic request routing.

## Architecture

### Components

- **`AssetManager`** - Main WorkerEntrypoint handling routing and project management
- **`AssetBinding`** - Entrypoint binding that provides `env.ASSETS` to server-side code
- **WorkerLoader** - Cloudflare's DynamicDispatch for loading and executing user code
- **Management API** - HTTP API for project operations

### Storage

The router worker uses two KV namespaces:

1. **`KV_PROJECTS`** - Project metadata and upload sessions
   - Project metadata: `project:projectId`
   - Upload sessions: `session:sessionId` (temporary, 1 hour TTL)

2. **`KV_SERVER_SIDE_CODE`** - Dynamic worker code
   - Manifest: `projectId:MANIFEST`
   - Modules: `projectId:contentHash` (content-addressed, deduplicated)
   - Stores base64-encoded module content

**Note:** Asset storage is handled by the separate Asset Service worker via RPC service binding. See `../asset-service/README.md` for details.

## Management API

All API endpoints require an `Authorization` header matching the `API_TOKEN` environment variable.

### Asset Upload Flow (Three-Phase)

The platform implements a three-phase upload flow for efficient asset deployment:

#### Phase 1: Create Upload Session

```http
POST /__api/projects/{projectId}/assets-upload-session
Content-Type: application/json
Authorization: your-api-token

{
  "manifest": {
    "/index.html": { "hash": "abc123...", "size": 1234 },
    "/style.css": { "hash": "def456...", "size": 567 }
  }
}
```

**Limits:**

- Maximum 20,000 asset files per deployment
- Maximum 25 MiB per individual asset file

Requests exceeding these limits will be rejected with a 413 status code.

Response includes JWT token and buckets of hashes to upload:

```json
{
  "result": {
    "jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "buckets": [["abc123...", "def456..."]]
  },
  "success": true
}
```

#### Phase 2: Upload Assets

```http
POST /__api/projects/{projectId}/assets/upload
Content-Type: application/json
Authorization: Bearer <JWT_FROM_PHASE_1>

{
  "abc123...": "base64-encoded-content",
  "def456...": "base64-encoded-content"
}
```

Returns completion JWT when all buckets uploaded:

```json
{
  "result": {
    "jwt": "completion-jwt-token"
  },
  "success": true
}
```

#### Phase 3: Deploy with Completion JWT

```http
POST /__api/projects/{projectId}/deploy
Content-Type: application/json
Authorization: your-api-token

{
  "completionJwt": "completion-jwt-token",
  "server": { ... },
  "config": { ... }
}
```

**Note:** The three-phase flow is automatically handled by the example scripts in `examples/`. For manual implementation, see the API Reference section in the main README.md.

### Create Project

```http
POST /__api/projects
Content-Type: application/json
Authorization: your-api-token

{
  "name": "My Project"
}
```

Response:

```json
{
  "success": true,
  "project": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Project",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z",
    "hasServerSideCode": false,
    "assetsCount": 0
  }
}
```

### List Projects

```http
GET /__api/projects
Authorization: your-api-token
```

### Get Project Info

```http
GET /__api/projects/{projectId}
Authorization: your-api-token
```

### Delete Project

```http
DELETE /__api/projects/{projectId}
Authorization: your-api-token
```

Deletes all project data: metadata, assets, manifest, and server-side code.

## Request Routing

### Routing Flow

1. **Extract project ID** from subdomain or path
2. **Verify project exists** in KV
3. **Rewrite URL** if using path-based routing
4. **Route request** based on `run_worker_first` configuration:

   **Assets-first mode** (default, `run_worker_first: false`):
   - Check if asset exists → Serve asset
   - If no asset → Run server-side code if available
   - Otherwise → 404

   **Worker-first mode** (`run_worker_first: true` or pattern match):
   - Run server-side code first
   - Server-side code can call `env.ASSETS.fetch()` to get assets
   - Full control over request handling

### Worker-First Configuration

```javascript
// Always run worker first
run_worker_first: true;

// Run worker first for specific patterns (glob syntax)
run_worker_first: ['/api/*', '/admin/**', '/*.json'];
```

The router uses [minimatch](https://github.com/isaacs/minimatch) for glob pattern matching.

## Server-Side Code

### Basic Example

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle API requests
    if (url.pathname.startsWith('/api/')) {
      return new Response('API response');
    }

    // Fallback to static assets
    return env.ASSETS.fetch(request);
  },
};
```

### With Asset Binding

```javascript
export default {
  async fetch(request, env, ctx) {
    // Custom logic
    const data = await fetch('https://api.example.com/data');

    // Get static asset and modify it
    const response = await env.ASSETS.fetch(request);

    // Or build dynamic response
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  },
};
```

### Environment Variables

Pass environment variables in the deployment payload:

```json
{
  "env": {
    "DATABASE_URL": "postgres://...",
    "API_KEY": "secret"
  }
}
```

Access them in your worker:

```javascript
export default {
  async fetch(request, env) {
    console.log(env.DATABASE_URL);
    console.log(env.API_KEY);
  },
};
```

## URL Schemes

### Subdomain-based (Recommended)

- Production: `project-id.yourdomain.com`
- Requires DNS configuration for wildcard subdomains

### Path-based

- Access: `yourdomain.com/__project/project-id/path/to/resource`
- URL is rewritten to `/path/to/resource` before processing
- Useful for development or when subdomain setup is not possible

## Development

### Commands

```bash
# Run tests
bun run test

# Deploy to Cloudflare
bun run deploy

# Local development
bun run dev

# Generate TypeScript types
bun run cf-typegen
```

### Environment Setup

Configure in `wrangler.jsonc`:

```jsonc
{
  "name": "asset-worker-router",
  "main": "src/worker.ts",
  "compatibility_date": "2025-11-11",
  "compatibility_flags": ["nodejs_compat", "enable_ctx_exports"],
  "kv_namespaces": [
    {
      "binding": "KV_PROJECTS",
      // id: "your-kv-namespace-id"
    },
    {
      "binding": "KV_SERVER_SIDE_CODE",
      // id: "your-kv-namespace-id"
    },
  ],
  "services": [
    {
      "binding": "ASSET_WORKER",
      "service": "asset-worker-asset-service",
    },
  ],
  "worker_loaders": [
    {
      "binding": "LOADER",
    },
  ],
}
```

## Dependencies

- **[Hono](https://hono.dev/)** - Lightweight web framework for management API
- **[minimatch](https://github.com/isaacs/minimatch)** - Glob pattern matching for routing
- **[@stablelib/base64](https://github.com/StableLib/stablelib)** - Base64 encoding/decoding

## Security

- API endpoints require `Authorization` header matching `API_TOKEN`
- Project isolation via KV namespacing with required `projectId` parameter
- Server-side code runs in isolated worker contexts
- Content-based asset addressing prevents cache poisoning
- JWTs for upload sessions expire after 1 hour

## License

MIT
