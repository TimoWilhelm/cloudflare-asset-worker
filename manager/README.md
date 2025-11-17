# Cloudflare Asset Worker Manager

A multi-tenant project management system for deploying and serving full-stack applications on Cloudflare Workers, combining static assets with optional dynamic server code.

## Overview

The Asset Manager provides a complete platform for hosting multiple projects on a single Cloudflare Worker deployment. It handles:

- Project lifecycle management (create, deploy, delete)
- Static asset serving via RPC calls to the Asset API
- Dynamic worker code execution using Cloudflare's DynamicDispatch (WorkerLoader)
- Flexible routing with subdomain-based or path-based URLs
- Intelligent request routing between static assets and server code

## Key Features

### Multi-Tenant Architecture
- **Project isolation** - Each project has its own namespace in KV storage
- **Subdomain routing** - `project-id.yourdomain.com`
- **Path-based routing** - `yourdomain.com/__project/project-id/`

### Full-Stack Support
- **Static assets** - HTML, CSS, JS, images, etc. via Asset API
- **Server code** - Optional dynamic worker code per project
- **Asset binding** - Server code can access static assets via `env.ASSETS`

### Intelligent Request Routing
- **Configurable order** - Choose between assets-first or worker-first handling
- **Glob pattern matching** - Route specific paths to worker using minimatch patterns
- **Fallback handling** - Automatic fallback from assets to worker or vice versa

### Management API
- **RESTful API** - Complete CRUD operations for projects
- **Token authentication** - Secure API access via `Authorization` header
- **Atomic deployments** - Deploy assets and server code together

## Architecture

### Components

- **`AssetManager`** - Main WorkerEntrypoint handling routing and project management
- **`AssetBinding`** - Entrypoint binding that provides `env.ASSETS` to server code
- **WorkerLoader** - Cloudflare's DynamicDispatch for loading and executing user code
- **Management API** - HTTP API for project operations

### Storage

Projects use three KV namespaces:

1. **`PROJECTS_KV_NAMESPACE`** - Project metadata
   - Project name, creation date, asset count, configuration
   - Key format: `project:{projectId}`

2. **`MANIFEST_KV_NAMESPACE`** - Asset manifests (managed by Asset API)
   - Binary manifest files mapping paths to content hashes
   - Key format: `{projectId}:ASSETS_MANIFEST`

3. **`SERVER_CODE_KV_NAMESPACE`** - Dynamic worker code
   - Entrypoint module, dependencies, environment variables
   - Key format: `{projectId}`

## Management API

All API endpoints require an `Authorization` header matching the `API_TOKEN` environment variable.

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
    "hasServerCode": false,
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

Deletes all project data: metadata, assets, manifest, and server code.

### Deploy Project

```http
POST /__api/projects/{projectId}/deploy
Content-Type: application/json
Authorization: your-api-token

{
  "projectName": "Updated Name",
  "assets": [
    {
      "pathname": "/index.html",
      "content": "base64-encoded-content",
      "contentType": "text/html"
    }
  ],
  "serverCode": {
    "entrypoint": "index.js",
    "modules": {
      "index.js": "export default { async fetch(request, env) { ... } }"
    },
    "compatibilityDate": "2025-11-09"
  },
  "config": {
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  },
  "run_worker_first": false,
  "env": {
    "API_KEY": "secret-value"
  }
}
```

## Request Routing

### Routing Flow

1. **Extract project ID** from subdomain or path
2. **Verify project exists** in KV
3. **Rewrite URL** if using path-based routing
4. **Route request** based on `run_worker_first` configuration:

   **Assets-first mode** (default, `run_worker_first: false`):
   - Check if asset exists → Serve asset
   - If no asset → Run server code if available
   - Otherwise → 404

   **Worker-first mode** (`run_worker_first: true` or pattern match):
   - Run server code first
   - Server code can call `env.ASSETS.fetch()` to get assets
   - Full control over request handling

### Worker-First Configuration

```javascript
// Always run worker first
run_worker_first: true

// Run worker first for specific patterns (glob syntax)
run_worker_first: [
  '/api/*',
  '/admin/**',
  '/*.json'
]
```

The manager uses [minimatch](https://github.com/isaacs/minimatch) for glob pattern matching.

## Server Code

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
  }
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
      headers: { 'Content-Type': 'text/html' }
    });
  }
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
  }
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
npm test

# Deploy to Cloudflare
npm run deploy

# Local development
npm run dev

# Generate TypeScript types
npm run cf-typegen
```

### Environment Setup

Configure in `wrangler.toml`:

```toml
name = "asset-manager"
main = "src/worker.ts"
compatibility_date = "2025-11-09"

[env.production]
vars = { API_TOKEN = "your-secure-token" }

[[kv_namespaces]]
binding = "PROJECTS_KV_NAMESPACE"
id = "your-kv-namespace-id"

[[kv_namespaces]]
binding = "MANIFEST_KV_NAMESPACE"
id = "your-kv-namespace-id"

[[kv_namespaces]]
binding = "SERVER_CODE_KV_NAMESPACE"
id = "your-kv-namespace-id"

[[services]]
binding = "ASSET_WORKER"
service = "asset-api"
```

## Dependencies

- **[Hono](https://hono.dev/)** - Lightweight web framework for management API
- **[minimatch](https://github.com/isaacs/minimatch)** - Glob pattern matching for routing

## Security

- API endpoints require `Authorization` header matching `API_TOKEN`
- Project isolation via KV namespacing
- Server code runs in isolated worker contexts
- Content-based asset addressing prevents cache poisoning

## License

MIT
