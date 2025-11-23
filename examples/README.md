# Deployment Examples

This directory contains example scripts demonstrating how to use the Cloudflare Multi-Project Deployment Platform.

## Three-Phase Upload Flow

All examples use the **three-phase upload flow** automatically via the `deployApplication()` helper:

```javascript
await deployApplication(projectId, {
  assets: [...],
  serverCode: {...},
  config: {...}
});
```

This automatically:

1. Calculates SHA-256 hashes and creates manifest
2. Uploads only new/changed files in optimized buckets
3. Finalizes deployment with JWT authentication

**Benefits:** Automatic deduplication, optimized batching, secure authentication, progress tracking.

For API details, see the main [README.md](../README.md#deploy-project-three-phase-upload-flow).

## Running the Examples

All examples use the management API running at `http://127.0.0.1:8787` by default.

When you run an example, you'll be prompted to provide:

1. **Orchestrator endpoint URL** (default: `http://127.0.0.1:8787`)
2. **API token** (required for authentication)

```bash
# From the examples directory
node deploy-example.js
node static-site-example.js
```

You'll see output showing each phase:

```
📝 Phase 1: Creating asset manifest...
  Created manifest with 3 files

🔄 Phase 2: Starting upload session...
  Uploading 1 bucket(s) with 2 new files...
  Uploading bucket 1/1 (2 files)...
  ✓ All assets uploaded

🚀 Phase 3: Finalizing deployment...

✓ Deployment complete!
  - Assets deployed: 3
  - New assets: 2
  - Cached assets: 1
```

### Setting up API Authentication

The management API requires authentication. For local development, create a `.env.local` file in the `workers/orchestrator` directory:

```bash
# workers/orchestrator/.env.local
API_TOKEN=your-secret-token-here
```

**Security Note:** Never commit `.env.local` to version control. The `.env.local` file is gitignored by default.

## Available Examples

### 1. Full-Stack Deployment (`deploy-example.js`)

Demonstrates deploying a complete application with:

- Static assets (HTML, CSS)
- Server-side code (API endpoints)
- Asset configuration
- Path-based routing for APIs
- Environment variables

### 2. Static Site Deployment (`static-site-example.js`)

Shows how to deploy a static website with:

- Multiple HTML pages
- CSS styling
- No server code required
- Asset-only deployment

## Usage Pattern

All examples use the `deployApplication()` helper from `shared-utils.js` which handles the three-phase flow automatically:

```javascript
import { createProject, deployApplication } from './shared-utils.js';

// 1. Create a project
const project = await createProject('My Project');

// 2. Prepare deployment
const deployment = {
  projectName: 'My Project',
  assets: [
    {
      pathname: '/index.html',
      content: Buffer.from('<html>...</html>', 'utf-8').toString('base64'),
      contentType: 'text/html; charset=utf-8'
    }
  ],
  serverCode: { // Optional
    entrypoint: 'index.js',
    modules: {
      // Modules MUST be base64-encoded
      'index.js': Buffer.from('export default { async fetch() { ... } }', 'utf-8').toString('base64')
    }
  },
  config: { // Optional - Asset serving configuration
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'single-page-application'
  },
  run_worker_first: ['/api/*', '/admin/**'] // Optional - Glob patterns for worker-first routing
};

// 3. Deploy (automatically handles three-phase upload)
await deployApplication(project.id, deployment);
```

The `deployApplication()` function automatically:

1. Creates asset manifest with SHA-256 hashes
2. Uploads assets in optimized buckets
3. Finalizes deployment with completion JWT

For manual three-phase implementation, see the API Reference section in the main [README.md](../README.md#deploy-project-three-phase-upload-flow).

## Base64 Encoding Assets

Assets must be base64 encoded before upload. In Node.js, use `Buffer` for proper encoding:

```javascript
// String content (use Buffer, not btoa)
const content = Buffer.from('Hello World', 'utf-8').toString('base64');

// File content
const fs = require('fs');
const fileContent = fs.readFileSync('file.png');
const content = fileContent.toString('base64');
```

**Note:** Do not use `btoa()` in Node.js - it's a browser API that doesn't handle Unicode properly. Always use `Buffer.from(string, 'utf-8').toString('base64')`.

## Server Code Format

Server code must export a default object with a `fetch` handler:

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/hello') {
      return new Response('Hello!');
    }

    // Return 404 to let assets handle other paths
    return new Response('Not found', { status: 404 });
  }
}
```

## Server Code Module Types

Supports: `js`, `cjs`, `py`, `text`, `data`, `json`. All modules must be **base64-encoded**:

```javascript
serverCode: {
  entrypoint: 'index.js',
  modules: {
    // Type inferred from extension
    'index.js': Buffer.from(code, 'utf-8').toString('base64'),

    // Explicit type specification
    'config.json': {
      content: Buffer.from(JSON.stringify({...}), 'utf-8').toString('base64'),
      type: 'json'
    }
  }
}
```

See [test-module-types.js](./test-module-types.js) for complete examples of all module types.

## Multiple Modules

You can include multiple JavaScript modules:

```javascript
serverCode: {
  entrypoint: 'index.js',
  modules: {
    'index.js': Buffer.from(`
      import { helper } from './utils.js';
      export default {
        async fetch() {
          return new Response(helper());
        }
      }
    `, 'utf-8').toString('base64'),
    'utils.js': Buffer.from(`
      export function helper() {
        return 'Hello from utility!';
      }
    `, 'utf-8').toString('base64')
  }
}
```

## Environment Variables

Pass environment variables in deployment:

```javascript
await deployApplication(projectId, {
  assets: [...],
  serverCode: {...},
  env: {
    ENVIRONMENT: 'production',
    API_URL: 'https://api.example.com'
  }
});
```

Access in worker via `env` parameter:

```javascript
export default {
  async fetch(request, env) {
    const apiUrl = env.API_URL || 'https://api.default.com';
    // All values are strings - convert as needed
  }
}
```

**Note:** For configuration only, not secrets. Updated by redeployment.

## Configuration Options

Configure asset serving and routing:

```javascript
{
  config: {
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'single-page-application'
  },
  run_worker_first: ['/api/*']  // Run worker first for API routes
}
```

See main [README.md](../README.md) for detailed configuration options.

## Common Patterns

**SPA (Single Page Application):**

```javascript
config: {
  html_handling: 'auto-trailing-slash',
  not_found_handling: 'single-page-application'
}
```

**Static Site + API:**

```javascript
{
  serverCode: { entrypoint: 'api.js', modules: {...} },
  run_worker_first: ['/api/*']  // Skip assets for API routes
}
```

See [deploy-example.js](./deploy-example.js) and [static-site-example.js](./static-site-example.js) for complete working examples.
