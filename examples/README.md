# Deployment Examples

This directory contains example projects demonstrating how to deploy applications using the **`cf-deploy` CLI tool**.

Each example is a complete, ready-to-deploy project with actual source files and configuration.

## Prerequisites

1. **Install dependencies** from workspace root:

   ```bash
   bun install
   ```

2. **Start the router worker**:

   ```bash
   bun run dev
   ```

## Available Examples

### 1. Static Site (`static-site/`)

A simple static website with HTML and CSS.

**Features:**

- Multiple HTML pages
- CSS styling
- No server-side code

**Deploy:**

```bash
cd examples/static-site
cf-deploy deploy --api-token your-token
```

**Project Structure:**

```text
static-site/
├── deploy.config.json
└── public/
    ├── index.html
    ├── about.html
    └── styles.css
```

---

### 2. Fullstack Application (`fullstack-app/`)

Complete application with both frontend assets and backend API.

**Features:**

- Static HTML/CSS frontend
- Server-side API endpoints
- Environment variables
- Worker-first routing for API paths

**Deploy:**

```bash
cd examples/fullstack-app
cf-deploy deploy --api-token your-token
```

**Project Structure:**

```text
fullstack-app/
├── deploy.config.json
├── public/
│   ├── index.html
│   └── style.css
└── server/
    └── index.js
```

**Try it:**

- Visit the deployed URL
- Click "Test API" to call `/api/hello`
- Click "Show Config" to see environment variables

---

### 3. API-Only Worker (`api-worker/`)

Backend-only service with no static assets.

**Features:**

- REST API endpoints
- Multiple route handlers
- Modular code organization

**Deploy:**

```bash
cd examples/api-worker
cf-deploy deploy --api-token your-token
```

**Project Structure:**

```text
api-worker/
├── deploy.config.json
└── src/
    ├── index.js
    └── handlers/
        ├── users.js
        └── posts.js
```

**API Endpoints:**

- `GET /health` - Health check
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get specific user
- `GET /api/posts` - List all posts
- `GET /api/posts/:id` - Get specific post

---

### 4. TanStack Start (`tanstack-start/`)

Full-stack React application using [TanStack Start](https://tanstack.com/start/latest) with SSR.

**Features:**

- Full-stack React with TanStack Router
- Server-side rendering (SSR)
- Server functions for data loading
- Modern CSS with dark mode support

**Deploy:**

```bash
cd examples/tanstack-start
bun install
bun run build
bun run deploy -- --api-token your-token
```

**Project Structure:**

```text
tanstack-start/
├── src/
│   ├── components/           # React components
│   ├── routes/               # File-based routes
│   ├── styles/               # CSS styles
│   └── router.tsx            # Router config
├── scripts/
│   └── deploy.js             # Deploy helper
├── deploy.config.json        # cf-deploy configuration
├── package.json
├── vite.config.ts
└── tsconfig.json
```

**Routes:**

- `/` - Home page with server-loaded data
- `/about` - About page explaining the deployment
- `/api-demo` - Interactive API demo with server functions

---

## Common Deployment Patterns

### Basic Deployment

```bash
cd examples/<example-name>
cf-deploy deploy --api-token your-token
```

### Dry Run (Preview)

See what would be deployed without actually deploying:

```bash
cf-deploy deploy --api-token your-token --dry-run
```

### List All Projects

```bash
cf-deploy list --api-token your-token
```

## Configuration File (`deploy.config.json`)

Each example includes a `deploy.config.json` file:

```json
{
  "projectName": "My App",
  "assets": {
    "directory": "./public",
    "patterns": ["**/*"]
  },
  "server": {
    "entrypoint": "index.js",
    "modulesDirectory": "./server"
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

See the [CLI README](../cli/README.md) for full configuration reference.

## Environment Variables

### Authentication

Set via environment or CLI flags:

```bash
cf-deploy deploy --api-token your-token
```

### Worker Environment Variables

Configure in `deploy.config.json`:

```json
{
  "env": {
    "DATABASE_URL": "${DATABASE_URL}",
    "API_KEY": "your-api-key"
  }
}
```

The `${VARIABLE}` syntax references local environment variables.

## Server-Side Code Requirements

Server-side code must export a default object with a `fetch` handler:

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/endpoint') {
      return new Response('Hello!');
    }

    // Return 404 to let assets handle other paths
    return new Response('Not found', { status: 404 });
  },
};
```

## Multiple Modules

The CLI automatically discovers and deploys all modules in the server directory:

```text
server/
├── index.js          # Entry point
├── handlers/
│   ├── users.js
│   └── posts.js
└── utils/
    └── helpers.js
```

Import between modules using ES modules syntax:

```javascript
import { handleUsers } from './handlers/users.js';
```

## Routing Patterns

### Assets-First (Default)

Check assets first, then run worker code:

```json
{
  "run_worker_first": false
}
```

### Worker-First for Specific Paths

Run worker code first for API routes:

```json
{
  "run_worker_first": ["/api/*", "/admin/**"]
}
```

### Always Worker-First

Run worker for all requests:

```json
{
  "run_worker_first": true
}
```

## Asset Configuration

### SPA (Single Page Application)

Serve `index.html` for all 404s:

```json
{
  "config": {
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  }
}
```

### Static Website

Standard HTML handling:

```json
{
  "config": {
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "none"
  }
}
```

## Tips

### Immutable Deployments

Each `deploy` creates a new immutable project. Old projects can be cleaned up via the management API.

### Multiple Environments

Create separate configs for different environments:

```text
examples/my-app/
├── deploy.config.json       # Development
├── staging.config.json      # Staging
└── production.config.json   # Production
```

Deploy to different environments:

```bash
# Development (local)
cf-deploy deploy --api-token your-token

# Staging
export CF_ROUTER_URL=https://staging.example.com
cf-deploy deploy --api-token your-token -c staging.config.json

# Production
export CF_ROUTER_URL=https://prod.example.com
cf-deploy deploy --api-token your-token -c production.config.json
```

### Ignore Files

Exclude files from deployment:

```json
{
  "assets": {
    "directory": "./dist",
    "patterns": ["**/*"],
    "ignore": ["**/*.map", "**/.DS_Store", "**/test/**"]
  }
}
```

## Learn More

- **[CLI Documentation](../cli/README.md)** - Complete CLI reference
- **[CLI Quick Start](../cli/QUICKSTART.md)** - 5-minute setup guide
- **[Router Documentation](../workers/router/README.md)** - API details
- **[Platform README](../README.md)** - Architecture overview

## Troubleshooting

### "API token is required"

```bash
cf-deploy deploy --api-token your-token
```

### "Assets directory not found"

Check that the `assets.directory` path exists relative to `deploy.config.json`.

### "Entrypoint module not found"

Ensure the `server.entrypoint` file exists in `server.modulesDirectory`.

### Deployment Fails

1. Check router worker is running: `bun run dev`
2. Verify API token is correct
3. Try with `--dry-run` to see what would be deployed

## Need Help?

- Check the [CLI README](../cli/README.md) for detailed documentation
- Review configuration in `deploy.config.json`
- Run with `--dry-run` to preview deployment
