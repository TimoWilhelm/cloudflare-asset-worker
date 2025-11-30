# API Worker Example

Backend-only REST API service with no static assets.

## What's Included

- `src/index.js` - Main entry point and router
- `src/handlers/users.js` - User endpoints
- `src/handlers/posts.js` - Post endpoints
- `deploy.config.json` - Server-only configuration

## Features

- REST API endpoints
- Modular handler organization
- No static assets
- Worker handles all requests
- Environment variables

## Deploy

```bash
# Set API token
export CF_API_TOKEN=your-token

# Deploy
cd examples/api-worker
npx cf-deploy deploy --create-project
```

## API Endpoints

### Health Check

```http
GET /health
```

Returns API status and environment info.

### Users

```http
GET /api/users          # List all users
GET /api/users/:id      # Get specific user
```

### Posts

```http
GET /api/posts          # List all posts
GET /api/posts/:id      # Get specific post
```

## Test the API

Using curl:

```bash
# Health check
curl https://your-project.workers.dev/health

# List users
curl https://your-project.workers.dev/api/users

# Get specific user
curl https://your-project.workers.dev/api/users/1

# List posts
curl https://your-project.workers.dev/api/posts

# Get specific post
curl https://your-project.workers.dev/api/posts/1
```

## Project Structure

```text
api-worker/
├── src/
│   ├── index.js           # Entry point, routing
│   └── handlers/
│       ├── users.js       # User API logic
│       └── posts.js       # Post API logic
└── deploy.config.json
```

## Configuration

Key settings in `deploy.config.json`:

```json
{
 "serverCode": {
  "entrypoint": "index.js",
  "modulesDirectory": "./src"
 },
 "run_worker_first": true
}
```

- **No assets** - Server code only
- **Worker-first** - All requests go to worker
- **Modular** - Handlers in separate files

## Add New Endpoints

1. **Create handler** in `src/handlers/`:

   ```javascript
   // src/handlers/comments.js
   export function handleComments(request, env) {
     return new Response(JSON.stringify({
       comments: [...]
     }), {
       headers: { 'Content-Type': 'application/json' }
     });
   }
   ```

2. **Import and route** in `src/index.js`:

   ```javascript
   import { handleComments } from './handlers/comments.js';

   if (url.pathname.startsWith('/api/comments')) {
    return handleComments(request, env);
   }
   ```

3. **Redeploy**:

   ```bash
   npx cf-deploy deploy
   ```

## Environment Variables

Configure in `deploy.config.json`:

```json
{
 "env": {
  "ENVIRONMENT": "production",
  "DATABASE_URL": "${DATABASE_URL}"
 }
}
```

Access in handlers:

```javascript
export function handleUsers(request, env) {
 const dbUrl = env.DATABASE_URL;
 // Use environment variables
}
```
