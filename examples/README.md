# Deployment Examples

This directory contains example projects demonstrating how to deploy applications using the **`cf-deploy` CLI tool**.

Each example is a complete, ready-to-deploy project with actual source files and configuration.

## Prerequisites

1. **Install dependencies** from workspace root:

   ```bash
   npm install
   ```

2. **Set your API token**:

   ```bash
   export CF_API_TOKEN=your-token
   ```

3. **Start the orchestrator worker**:

   ```bash
   npm run dev
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
npx cf-deploy deploy --create-project
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
npx cf-deploy deploy --create-project
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
npx cf-deploy deploy --create-project
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

## Common Deployment Patterns

### Basic Deployment

```bash
cd examples/<example-name>
export CF_API_TOKEN=your-token
npx cf-deploy deploy --create-project
```

### Dry Run (Preview)

See what would be deployed without actually deploying:

```bash
npx cf-deploy deploy --dry-run
```

### Update Existing Project

Deploy to an existing project by its ID:

```bash
npx cf-deploy deploy --project-id your-project-id
```

### List All Projects

```bash
npx cf-deploy list
```

## Configuration File (`deploy.config.json`)

Each example includes a `deploy.config.json` file:

```json
{
 "projectName": "My App",
 "projectId": null,
 "assets": {
  "directory": "./public",
  "patterns": ["**/*"]
 },
 "serverCode": {
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
# Environment variable (recommended)
export CF_API_TOKEN=your-token

# Or via CLI flag
npx cf-deploy deploy --api-token your-token
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

## Server Code Requirements

Server code must export a default object with a `fetch` handler:

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

### Fast Redeployment

Changes to assets or server code can be redeployed quickly:

```bash
npx cf-deploy deploy  # Uses projectId from config
```

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
npx cf-deploy deploy

# Staging
export CF_ORCHESTRATOR_URL=https://staging.example.com
npx cf-deploy deploy -c staging.config.json

# Production
export CF_ORCHESTRATOR_URL=https://prod.example.com
npx cf-deploy deploy -c production.config.json
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
- **[Orchestrator Documentation](../workers/orchestrator/README.md)** - API details
- **[Platform README](../README.md)** - Architecture overview

## Troubleshooting

### "API token is required"

```bash
export CF_API_TOKEN=your-token
```

### "Assets directory not found"

Check that the `assets.directory` path exists relative to `deploy.config.json`.

### "Entrypoint module not found"

Ensure the `serverCode.entrypoint` file exists in `serverCode.modulesDirectory`.

### Deployment Fails

1. Check orchestrator worker is running: `npm run dev`
2. Verify API token is correct
3. Try with `--dry-run` to see what would be deployed

## Need Help?

- Check the [CLI README](../cli/README.md) for detailed documentation
- Review configuration in `deploy.config.json`
- Run with `--dry-run` to preview deployment
