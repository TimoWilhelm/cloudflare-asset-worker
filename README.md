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

This repository contains two workers working together:

- **`api/`** - Asset serving worker that handles static assets with project namespacing. Core functionality remains focused on efficient asset storage and retrieval.
- **`manager/`** - Platform management worker that orchestrates deployments, manages projects, routes requests, and executes dynamic server code.

## Quick Start

### 1. Create a Project

```bash
curl -X POST https://your-manager.workers.dev/__api/projects \
  -H "Content-Type: application/json" \
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
      "index.js": "export default { async fetch(req) { return new Response('API!'); } }"
    },
    "compatibilityDate": "2025-11-09"
  }
}
```

### 3. Access Your Project

- Via path: `https://your-manager.workers.dev/__project/550e8400-e29b-41d4-a716-446655440000/`
- Via subdomain (production): `https://550e8400-e29b-41d4-a716-446655440000.yourdomain.com/`

## API Reference

### Project Management

#### Create Project
```
POST /__api/projects
Content-Type: application/json

{
  "name": "Project Name" // optional
}
```

#### List Projects
```
GET /__api/projects
```

#### Get Project Info
```
GET /__api/projects/:projectId
```

#### Delete Project
```
DELETE /__api/projects/:projectId
```

#### Deploy Project
```
POST /__api/projects/:projectId/deploy
Content-Type: application/json

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
  }
}
```

## How It Works

### Request Flow

1. **Request arrives** at the manager worker
2. **Project ID extracted** from subdomain or path
3. **Project existence verified** from `PROJECTS_KV_NAMESPACE`
4. **Asset check**: Manager checks if AssetApi can serve the request
5. **Asset serving**: If asset exists, it's served with proper caching headers
6. **Server code fallback**: If no asset and server code exists, dynamic worker is loaded
7. **Dynamic execution**: Server code runs with isolated environment

### Storage Strategy

- **Assets KV** (`ASSETS_KV_NAMESPACE`): Stores all assets with keys like `projectId:contentHash`
- **Manifest KV** (`MANIFEST_KV_NAMESPACE`): Stores asset manifests with keys like `projectId:ASSETS_MANIFEST`
- **Projects KV** (`PROJECTS_KV_NAMESPACE`): Stores project metadata with keys like `project:projectId`
- **Server Code KV** (`SERVER_CODE_KV_NAMESPACE`): Stores server code configuration with key `projectId`

### Asset Serving Configuration

Configure via `wrangler.jsonc` in the `api/` directory:

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

## License

MIT
