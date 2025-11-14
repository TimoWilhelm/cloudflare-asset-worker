# Deployment Examples

This directory contains example scripts demonstrating how to deploy applications to the Multi-Project Deployment Platform.

## Examples

### 1. Full-Stack Application (`deploy-example.js`)

Complete example showing:
- Creating a project
- Deploying HTML, CSS, and JavaScript assets
- Adding server-side code with API endpoints
- Accessing the deployed application

**Run:**
```bash
node deploy-example.js
```

### 2. Static Website (`static-site-example.js`)

Simple static site deployment without server code:
- Multiple HTML pages
- CSS styling
- Pure static asset serving

**Run:**
```bash
node static-site-example.js
```

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
  }
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

## Common Patterns

### SPA (Single Page Application)

For React/Vue/Angular apps, configure the API worker with SPA routing:

```jsonc
// In api/wrangler.jsonc
{
  "vars": {
    "CONFIG": {
      "html_handling": "auto-trailing-slash",
      "not_found_handling": "single-page-application"
    }
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

Deploy both static files and server code. Server code only handles API routes:

```javascript
{
  assets: [
    { pathname: '/', content: btoa('...'), contentType: 'text/html' },
    { pathname: '/about', content: btoa('...'), contentType: 'text/html' }
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
  }
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
