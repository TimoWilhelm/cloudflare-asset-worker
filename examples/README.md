# Deployment Examples

This directory contains example scripts demonstrating how to use the Cloudflare Multi-Project Deployment Platform.

## Running the Examples

All examples use the management API running at `http://127.0.0.1:8787` by default.

```bash
# From the examples directory
node deploy-example.js
node static-site-example.js
```

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

All examples follow this pattern:

```javascript
// 1. Create a project
const response = await fetch(`${MANAGER_URL}/__api/projects`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'My Project' })
});

const { project } = await response.json();

// 2. Prepare deployment
const deployment = {
  projectName: 'My Project',
  assets: [
    {
      pathname: '/index.html',
      content: btoa('<html>...</html>'), // Base64 encoded
      contentType: 'text/html; charset=utf-8'
    }
  ],
  serverCode: { // Optional
    entrypoint: 'index.js',
    modules: {
      'index.js': 'export default { async fetch() { ... } }'
    }
  },
  config: { // Optional - Asset serving configuration
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'single-page-application'
  },
  run_worker_first: ['/api/*', '/admin/**'] // Optional - Glob patterns for worker-first routing
};

// 3. Deploy
await fetch(`${MANAGER_URL}/__api/projects/${project.id}/deploy`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(deployment)
});
```

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

## Multiple Modules

You can include multiple JavaScript modules:

```javascript
serverCode: {
  entrypoint: 'index.js',
  modules: {
    'index.js': `
      import { helper } from './utils.js';
      export default {
        async fetch() {
          return new Response(helper());
        }
      }
    `,
    'utils.js': `
      export function helper() {
        return 'Hello from utility!';
      }
    `
  }
}
```

## Environment Variables

Environment variables are stored with your server code deployment and injected into your worker at runtime. They are deployment-specific and updated through redeployment.

**Note:** Environment variables are intended for non-secret configuration values (feature flags, URLs, limits, etc.).

### Setting Environment Variables During Deployment

```javascript
const deployment = {
  projectName: 'My App',
  assets: [...],
  serverCode: {...},
  env: {
    ENVIRONMENT: 'production',
    API_URL: 'https://api.example.com',
    APP_NAME: 'My App',
    MAX_ITEMS_PER_PAGE: '20',
    DEBUG: 'false',
    FEATURE_NEW_UI: 'true'
  }
};

await fetch(`${MANAGER_URL}/__api/projects/${projectId}/deploy`, {
  method: 'POST',
  body: JSON.stringify(deployment)
});
```

### Accessing Environment Variables in Server Code

```javascript
export default {
  async fetch(request, env, ctx) {
    // Access environment variables through the env parameter
    const apiUrl = env.API_URL || 'https://api.default.com';
    const appName = env.APP_NAME || 'My App';
    const maxItems = parseInt(env.MAX_ITEMS_PER_PAGE || '10');
    const isDebug = env.DEBUG === 'true';

    // Use in your code
    const data = {
      app: appName,
      limit: maxItems,
      debug: isDebug
    };

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

### Updating Environment Variables

To update environment variables, deploy again with the new values. Each deployment replaces the previous environment.

```javascript
// Initial deployment with env vars
await deployApplication(projectId, {
  assets: [...],
  serverCode: {...},
  env: {
    ENVIRONMENT: 'development',
    MAX_ITEMS_PER_PAGE: '10',
    FEATURE_NEW_UI: 'false'
  }
});

// Update env vars by redeploying
await deployApplication(projectId, {
  assets: [...], // Same or updated assets
  serverCode: {...}, // Same or updated code
  env: {
    ENVIRONMENT: 'production', // Updated
    MAX_ITEMS_PER_PAGE: '20', // Updated
    FEATURE_NEW_UI: 'true', // Updated
    CACHE_TTL: '3600' // New variable
  }
});
```

**Removing Environment Variables:**
Deploy without the `env` field or with an empty object:

```javascript
await deployApplication(projectId, {
  assets: [...],
  serverCode: {...}
  // No env field - removes all environment variables
});
```

### Best Practices

1. **Non-Secret Values**: Use env vars for configuration, not secrets (use Cloudflare secrets for sensitive data)
2. **Deployment-Specific**: Environment variables are tied to deployments, not managed separately
3. **Naming**: Use UPPER_SNAKE_CASE for environment variable names
4. **Types**: All values are strings; convert as needed (`env.DEBUG === 'true'`, `parseInt(env.MAX_ITEMS)`)
5. **Defaults**: Always provide fallback values for optional variables
6. **Validation**: Validate and type-check environment variables at runtime
7. **Versioning**: Track environment configurations alongside code in your deployment process

**Example with Best Practices:**
```javascript
export default {
  async fetch(request, env) {
    // Provide defaults for all variables
    const environment = env.ENVIRONMENT || 'production';
    const debug = env.DEBUG === 'true';
    const apiUrl = env.API_URL || 'https://api.default.com';
    const maxItems = parseInt(env.MAX_ITEMS_PER_PAGE || '10');

    // Validate required variables
    if (!env.APP_NAME) {
      return new Response('Configuration error: APP_NAME required', { status: 500 });
    }

    // Use environment variables
    return new Response(JSON.stringify({
      app: env.APP_NAME,
      environment,
      debug,
      maxItems,
      timestamp: Date.now()
    }));
  }
}
```

## Configuration Options

### Asset Configuration (`config`)

Configure how assets are served per-project:

```javascript
config: {
  // HTML handling mode
  html_handling: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none',

  // 404 handling
  not_found_handling: 'single-page-application' | '404-page' | 'none',

  // Custom redirects (optional)
  redirects: {
    version: 1,
    staticRules: {},
    rules: {}
  },

  // Custom headers (optional)
  headers: {
    version: 2,
    rules: {}
  }
}
```

### Worker-First Routing (`run_worker_first`)

Control when server code runs vs checking assets:

```javascript
// Boolean: always or never run worker first
run_worker_first: true  // Always run worker first
run_worker_first: false // Always check assets first (default)

// Array: run worker first for matching paths (glob patterns)
run_worker_first: [
  '/api/*',        // Match /api/users, /api/posts, etc.
  '/admin/**',     // Match /admin and all sub-paths
  '/auth'          // Exact match
]
```

**Benefits:**
- Avoid unnecessary asset checks for API routes
- Better performance for worker-heavy paths
- Fine-grained control over request routing

## Common Patterns

### SPA (Single Page Application)

For React/Vue/Angular apps, use SPA config in your deployment:

```javascript
{
  assets: [...],
  config: {
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'single-page-application'
  }
}
```

Then deploy your built assets:
```javascript
{
  assets: [
    { pathname: '/index.html', content: '...', contentType: 'text/html' },
    { pathname: '/assets/app.js', content: '...', contentType: 'application/javascript' },
    { pathname: '/assets/style.css', content: '...', contentType: 'text/css' }
  ]
}
```

### API with Database Access

Server code can access KV, D1, R2, and other Cloudflare bindings if you configure them in the worker loader:

```javascript
// Note: This requires additional setup in the manager worker
const worker = this.env.LOADER.get(codeHash, () => {
  return {
    compatibilityDate: '2025-11-09',
    mainModule: entrypoint,
    modules,
    env: {
      // Add bindings here
      MY_KV: this.env.MY_KV,
      MY_D1: this.env.MY_D1
    }
  };
});
```

### Static Site with API Routes

Deploy both static files and server code. Use `run_worker_first` for API routes:

```javascript
{
  assets: [
    { pathname: '/index.html', content: btoa('...'), contentType: 'text/html' },
    { pathname: '/about.html', content: btoa('...'), contentType: 'text/html' }
  ],
  serverCode: {
    entrypoint: 'api.js',
    modules: {
      'api.js': `
        export default {
          async fetch(request) {
            const url = new URL(request.url);

            // Only handle /api/* routes
            if (url.pathname.startsWith('/api/')) {
              return new Response(JSON.stringify({ data: 'API response' }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }

            // Let assets handle everything else
            return new Response(null, { status: 404 });
          }
        }
      `
    }
  },
  config: {
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'none'
  },
  // Skip asset checks for API routes - improves performance
  run_worker_first: ['/api/*']
}
```

## Tips

1. **Content Types**: Always specify the correct `contentType` for better caching and browser handling
2. **Asset Deduplication**: Assets with the same content hash are automatically deduplicated
3. **Incremental Deployments**: Only new assets are uploaded; existing ones are skipped
4. **Error Handling**: Check the `success` field in all API responses
5. **Project IDs**: Save project IDs for future deployments to the same project

## Building a Deployment Tool

You can use these examples as a foundation for building:
- CLI deployment tools
- CI/CD integrations
- Web-based deployment dashboards
- Framework-specific plugins (Next.js, Nuxt, etc.)

## Next Steps

- Explore the main README for full API documentation
- Review SETUP.md for deployment instructions
- Customize examples for your specific use case
