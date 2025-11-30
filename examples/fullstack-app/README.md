# Fullstack Application Example

Complete application with frontend assets and backend API endpoints.

## What's Included

**Frontend:**

- `public/index.html` - Interactive UI with API test buttons
- `public/style.css` - Styling

**Backend:**

- `server/index.js` - API endpoints with environment variable usage
- `server/template.txt` - Text module example
- `server/config.json` - JSON module example
- `server/data.bin` - Binary data module example

**Config:**

- `deploy.config.json` - Full deployment configuration

## Features

- Static asset serving
- Server-side API endpoints
- Environment variables
- Worker-first routing for `/api/*` paths
- Single Page Application fallback
- **Module type imports**: Demonstrates importing text, JSON, and binary data modules

## Deploy

```bash
# Set API token
export CF_API_TOKEN=your-token

# Deploy
cd examples/fullstack-app
npx cf-deploy deploy --create-project
```

## Try It Out

After deployment, visit your app URL:

1. **Test API Button** - Calls `/api/hello` to see server response
2. **Show Config Button** - Calls `/api/config` to see environment variables

Both buttons will display the JSON response from the server.

## API Endpoints

- `GET /api/hello` - Returns greeting with timestamp and environment variables
- `GET /api/template` - Demonstrates **text module** import (template.txt)
- `GET /api/config` - Demonstrates **JSON module** import (config.json)
- `GET /api/data` - Demonstrates **binary data module** import (data.bin)

All other paths serve static assets from `public/`.

## Configuration Highlights

### Worker-First Routing

```json
"run_worker_first": ["/api/*"]
```

API requests go directly to the worker, bypassing asset lookup.

### Environment Variables

```json
"env": {
  "ENVIRONMENT": "production",
  "API_URL": "https://api.example.com",
  "APP_NAME": "Fullstack Example"
}
```

Access these in worker code via `env` parameter.

### Module Type Imports

The example demonstrates importing different module types:

**Text Module (`.txt`):**

```javascript
import templateText from './template.txt';
```

**JSON Module (`.json`):**

```javascript
import configData from './config.json';
```

**Binary Data Module (`.bin`):**

```javascript
import binaryData from './data.bin';
```

These imports are automatically detected and handled by the deployment system based on file extensions.

## Customize

**Add New Endpoints:**

Edit `server/index.js`:

```javascript
if (url.pathname === '/api/newEndpoint') {
 return new Response(JSON.stringify({ data: 'value' }), {
  headers: { 'Content-Type': 'application/json' },
 });
}
```

**Update Frontend:**

Modify `public/index.html` and `public/style.css`.

**Redeploy:**

```bash
npx cf-deploy deploy
```
