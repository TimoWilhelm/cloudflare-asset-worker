# Cloudflare Multi-Project Deployment Platform

> **⚠️ Experimental Project** - This is an experimental project and is under active development. APIs and behavior may change without notice.

A complete deployment platform for full-stack applications on Cloudflare Workers. Deploy unlimited projects, each with static assets served from KV and dynamic server-side code using Cloudflare's dynamic worker loading feature.

This project demonstrates how to build a multi-tenant platform similar to Vercel, Netlify, or Cloudflare Pages, but with full control over the infrastructure.

## Key Features

- **Multi-Project Support** - Deploy unlimited full-stack applications, each isolated with a unique project ID
- **Namespaced Asset Storage** - Assets are stored in KV with project-level namespacing for complete isolation
- **Dynamic Server Code** - Server-side code stored in KV and loaded dynamically per request using Worker Loaders
- **Flexible Routing** - Access projects via subdomain (`project-id.domain.com`) or path-based routing (`/__project/project-id/`)
- **Complete Project Management** - REST API for creating, listing, deploying, and deleting projects
- **Asset Serving** - Advanced routing, redirects, custom headers, and efficient caching

## Architecture

This repository contains two workers working together via Service Bindings (RPC):

- **`api/`** - Asset serving worker (`AssetApi`) that handles static assets with project namespacing. Exposes RPC methods for serving, uploading, and managing assets.
- **`manager/`** - Platform management worker (`AssetManager`) that orchestrates deployments, manages projects, routes requests, and executes dynamic server code. Calls the Asset API via RPC.

The manager worker uses Cloudflare's Service Bindings to communicate with the API worker, and WorkerLoaders to dynamically execute user-provided server code.

## Prerequisites

1. **Deploy both workers** to Cloudflare:
   ```bash
   cd api && npm run deploy
   cd ../manager && npm run deploy
   ```

2. **Configure API Token** - Set the `API_TOKEN` environment variable in your manager worker:
   ```bash
   wrangler secret put API_TOKEN
   ```

3. **Configure KV Namespaces** - Update `wrangler.jsonc` in both `api/` and `manager/` with your KV namespace IDs

## Quick Start

### 1. Create a Project

```bash
curl -X POST https://your-manager.workers.dev/__api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: your-api-token" \
  -d '{"name": "My Full-Stack App"}'
```

Response:
```json
{
  "success": true,
  "project": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Full-Stack App",
    "createdAt": "2025-11-14T18:00:00.000Z",
    "updatedAt": "2025-11-14T18:00:00.000Z",
    "hasServerCode": false,
    "assetsCount": 0
  }
}
```

### 2. Deploy Your Application

```bash
curl -X POST https://your-manager.workers.dev/__api/projects/550e8400-e29b-41d4-a716-446655440000/deploy \
  -H "Content-Type: application/json" \
  -H "Authorization: your-api-token" \
  -d @deployment.json
```

Example `deployment.json`:
```json
{
  "projectName": "My App",
  "assets": [
    {
      "pathname": "/index.html",
      "content": "PCFET0NUWVBFIGh0bWw+...",
      "contentType": "text/html; charset=utf-8"
    },
    {
      "pathname": "/style.css",
      "content": "Ym9keSB7IG1hcmdpbjogMDsgfQ==",
      "contentType": "text/css"
    }
  ],
  "serverCode": {
    "entrypoint": "index.js",
    "modules": {
      "index.js": "export default { async fetch(req, env) { return new Response('API: ' + env.ENVIRONMENT); } }"
    },
    "compatibilityDate": "2025-11-09"
  },
  "config": {
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  },
  "run_worker_first": ["/api/*"],
  "env": {
    "ENVIRONMENT": "production"
  }
}
```

### 3. Access Your Project

- Via path: `https://your-manager.workers.dev/__project/550e8400-e29b-41d4-a716-446655440000/`
- Via subdomain (production): `https://550e8400-e29b-41d4-a716-446655440000.yourdomain.com/`

## API Reference

### Project Management

All API endpoints require an `Authorization` header matching the `API_TOKEN` environment variable.

#### Create Project
```
POST /__api/projects
Content-Type: application/json
Authorization: your-api-token

{
  "name": "Project Name" // optional
}
```

#### List Projects
```
GET /__api/projects
Authorization: your-api-token
```

#### Get Project Info
```
GET /__api/projects/:projectId
Authorization: your-api-token
```

#### Delete Project
```
DELETE /__api/projects/:projectId
Authorization: your-api-token
```

#### Deploy Project
```
POST /__api/projects/:projectId/deploy
Content-Type: application/json
Authorization: your-api-token

{
  "projectName": "Optional new name",
  "assets": [
    {
      "pathname": "/path",
      "content": "base64-encoded-content",
      "contentType": "mime/type"
    }
  ],
  "serverCode": { // optional
    "entrypoint": "index.js",
    "modules": {
      "index.js": "code...",
      "utils.js": "code..."
    },
    "compatibilityDate": "2025-11-09"
  },
  "config": { // optional - per-project asset configuration
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  },
  "run_worker_first": false, // optional - boolean or string[] of patterns
  "env": { // optional - environment variables for server code
    "API_KEY": "value",
    "ENVIRONMENT": "production"
  }
}
```

## How It Works

### Request Flow

1. **Request arrives** at the manager worker
2. **API routing**: Requests to `/__api/*` go to management API (requires authentication)
3. **Project ID extracted** from subdomain or path
4. **Project existence verified** from `PROJECTS_KV_NAMESPACE`
5. **Routing decision**: Based on `run_worker_first` configuration:
   - **Assets-first** (default): Check if asset exists → serve asset → fallback to server code
   - **Worker-first**: Execute server code → server code can call `env.ASSETS.fetch()`
6. **Response**: Asset or dynamic worker response with proper headers

### Storage Strategy

- **Assets KV** (`ASSETS_KV_NAMESPACE`): Stores all assets with keys like `projectId:contentHash`
- **Manifest KV** (`MANIFEST_KV_NAMESPACE`): Stores asset manifests with keys like `projectId:ASSETS_MANIFEST`
- **Projects KV** (`PROJECTS_KV_NAMESPACE`): Stores project metadata with keys like `project:projectId`
- **Server Code KV** (`SERVER_CODE_KV_NAMESPACE`): Stores server code configuration with key `projectId`

### Asset Serving Configuration

Asset configuration is **per-project** and passed during deployment via the `config` field:

```json
{
  "config": {
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application",
    "redirects": {
      "version": 1,
      "staticRules": {
        "/old": { "to": "/new", "status": 301, "lineNumber": 1 }
      },
      "rules": {}
    },
    "headers": {
      "version": 2,
      "rules": {
        "/*.html": {
          "set": { "Cache-Control": "public, max-age=3600" },
          "unset": ["X-Powered-By"]
        }
      }
    }
  }
}
```

#### Configuration Options

- **`html_handling`**: `"auto-trailing-slash"` | `"force-trailing-slash"` | `"drop-trailing-slash"` | `"none"`
- **`not_found_handling`**: `"single-page-application"` | `"404-page"` | `"none"`
- **`redirects`**: Static and dynamic redirect rules with status codes (301, 302, 303, 307, 308)
- **`headers`**: Custom headers per pathname pattern (glob-based matching)

### Request Routing Configuration

Control the order of asset vs. worker execution per project:

```json
{
  "run_worker_first": false  // Default: check assets first, fallback to worker
}
```

Or use glob patterns to run worker first only for specific paths:

```json
{
  "run_worker_first": ["/api/*", "/admin/**"]
}
```

### Environment Variables

Pass environment variables to your server code:

```json
{
  "env": {
    "ENVIRONMENT": "production",
    "API_KEY": "secret-value",
    "DATABASE_URL": "postgres://..."
  }
}
```

Access in server code via `env` parameter:

```javascript
export default {
  async fetch(request, env) {
    console.log(env.ENVIRONMENT); // "production"
    console.log(env.API_KEY);     // "secret-value"
  }
};
```

## Asset Upload Flow

This platform implements a three-phase upload flow following Cloudflare's official Workers API pattern:

1. **Phase 1: Register Manifest** - Submit asset metadata and receive upload instructions
2. **Phase 2: Upload Assets** - Upload files in optimized buckets with JWT authentication
3. **Phase 3: Deploy** - Finalize deployment with completion JWT

Benefits:
- **Deduplication** - Skip uploading unchanged files automatically
- **Optimized batching** - Files grouped in buckets for efficient uploads
- **Security** - JWT-based authentication per upload session
- **Efficiency** - Only upload what's needed

**The three-phase flow is automatically used by all examples** through the `deployApplication()` function in `shared-utils.js`.

📖 **See [UPLOAD_FLOW.md](./UPLOAD_FLOW.md) for complete API documentation and advanced usage**

## Server Code Module Types

Server code modules support multiple types matching Cloudflare Workers API:

- **`js`** - ES modules with import/export (`.js`, `.mjs`)
- **`cjs`** - CommonJS modules with require() (`.cjs`)
- **`py`** - Python modules (`.py`)
- **`text`** - Importable text strings (`.txt`)
- **`data`** - Binary data as ArrayBuffer
- **`json`** - Parsed JSON objects (`.json`)

### Module Encoding

Modules need to be **base64-encoded** for transfer:

```javascript
serverCode: {
  entrypoint: 'index.js',
  modules: {
    // Simple format - type inferred from extension
    'index.js': Buffer.from(codeString, 'utf-8').toString('base64'),

    // Explicit type format
    'config.json': {
      content: Buffer.from(JSON.stringify(data), 'utf-8').toString('base64'),
      type: 'json'
    }
  }
}
```

## Examples

The `examples/` directory contains ready-to-run deployment scripts that automatically use the three-phase upload flow:

- **`deploy-example.js`** - Deploy a full-stack app with assets, server code, and environment variables
- **`static-site-example.js`** - Deploy a static website (HTML, CSS only)
- **`test-module-types.js`** - Test all module types (js, json, text, data)
- **`test-servercode-encoding.js`** - Test base64 encoding/decoding
- **`test-redeployment.js`** - Test asset caching optimization

Run examples with Node.js:

```bash
# Full-stack app
node examples/deploy-example.js

# Static site
node examples/static-site-example.js
```

Both examples will show the three-phase upload progress automatically. The `shared-utils.js` module handles all the complexity internally.

## Project Structure

```
.
├── api/              # Asset API worker (RPC service)
│   ├── src/          # Source code for asset serving
│   ├── tests/        # Tests for asset API
│   └── README.md     # API documentation
├── manager/          # Manager worker (main orchestrator)
│   ├── src/          # Source code for project management
│   └── README.md     # Manager documentation
└── examples/         # Deployment examples
    ├── deploy-example.js          # Full-stack deployment
    ├── static-site-example.js     # Static site deployment
    └── shared-utils.js            # Shared utilities
```

## License

MIT
