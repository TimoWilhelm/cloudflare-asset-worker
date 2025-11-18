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

Deployment uses a **three-phase upload flow**:

1. **Create upload session** with asset manifest
2. **Upload asset buckets** with JWT authentication
3. **Finalize deployment** with completion JWT

See the [examples](#examples) directory for ready-to-use deployment scripts, or the [API Reference](#api-reference) section below for direct API usage.

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

#### Deploy Project (Three-Phase Upload Flow)

Deployment uses a three-phase upload flow for efficiency and deduplication:

**Phase 1: Create Upload Session**

```http
POST /__api/projects/:projectId/assets-upload-session
Content-Type: application/json
Authorization: your-api-token

{
  "manifest": {
    "/index.html": {
      "hash": "a1b2c3d4...",  // SHA-256 hash (64 hex chars)
      "size": 1234
    },
    "/style.css": {
      "hash": "e5f6g7h8...",
      "size": 5678
    }
  }
}
```

Response includes JWT and buckets of hashes to upload:

```json
{
  "result": {
    "jwt": "<UPLOAD_TOKEN>",
    "buckets": [
      ["a1b2c3d4...", "e5f6g7h8..."]
    ]
  },
  "success": true
}
```

**Phase 2: Upload Assets**

```http
POST /__api/projects/:projectId/assets/upload
Content-Type: application/json
Authorization: Bearer <UPLOAD_TOKEN>

{
  "a1b2c3d4...": "<base64_encoded_content>",
  "e5f6g7h8...": "<base64_encoded_content>"
}
```

Upload each bucket sequentially. Last bucket returns completion JWT:

```json
{
  "result": {
    "jwt": "<COMPLETION_TOKEN>"
  },
  "success": true
}
```

**Phase 3: Finalize Deployment**

```http
POST /__api/projects/:projectId/deploy
Content-Type: application/json
Authorization: your-api-token

{
  "completionJwt": "<COMPLETION_TOKEN>",
  "projectName": "Optional new name",
  "serverCode": {  // optional
    "entrypoint": "index.js",
    "modules": {
      "index.js": "<base64-encoded-module>",
      "utils.js": "<base64-encoded-module>"
    },
    "compatibilityDate": "2025-11-09"
  },
  "config": {  // optional
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  },
  "run_worker_first": false,  // optional - boolean or string[] of patterns
  "env": {  // optional - environment variables
    "API_KEY": "value",
    "ENVIRONMENT": "production"
  }
}
```

Response:

```json
{
  "success": true,
  "message": "Project deployed successfully",
  "project": { ... },
  "deployedAssets": 10,
  "newAssets": 2,
  "skippedAssets": 8
}
```

**Key Points:**

- Hashes must be 64-character SHA-256 hex strings
- Assets and server code modules must be base64-encoded
- If all assets cached, buckets array is empty and JWT is completion token immediately
- JWTs expire after 1 hour
- Upload buckets sequentially in provided order

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

### Configuration

**Asset Serving:**
- `html_handling`: `"auto-trailing-slash"` | `"force-trailing-slash"` | `"drop-trailing-slash"` | `"none"`
- `not_found_handling`: `"single-page-application"` | `"404-page"` | `"none"`
- `redirects`: Static/dynamic redirect rules (301, 302, 303, 307, 308)
- `headers`: Custom headers per pathname pattern (glob-based)

**Request Routing:**
- `run_worker_first: false` (default) - Check assets first, fallback to worker
- `run_worker_first: ["/api/*"]` - Run worker first for matching paths

**Environment Variables:**
Pass via `env` field, access in worker via `env` parameter. Values are strings.

## Server Code

### Module Types

Supports: `js` (ES modules), `cjs` (CommonJS), `py` (Python), `text` (strings), `data` (ArrayBuffer), `json` (objects). All modules must be **base64-encoded**. Type is inferred from extension or specified explicitly. See [examples/test-module-types.js](./examples/test-module-types.js) for usage.

## Examples

The `examples/` directory contains ready-to-run deployment scripts that automatically use the three-phase upload flow:

- **`deploy-example.js`** - Deploy a full-stack app with assets, server code, and environment variables
- **`static-site-example.js`** - Deploy a static website (HTML, CSS only)
- **`test-module-types.js`** - Test all module types (js, json, text, data)
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
