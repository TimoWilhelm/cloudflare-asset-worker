# TanStack Start Example

A complete [TanStack Start](https://tanstack.com/start/latest) full-stack React application configured for deployment using the cf-deploy CLI.

## What's Included

**Application:**

- `src/routes/` - TanStack Router file-based routes
- `src/components/` - React components
- `src/styles/` - CSS styles
- `src/router.tsx` - Router configuration

**Configuration:**

- `package.json` - Dependencies and scripts
- `vite.config.ts` - Vite + TanStack Start + Cloudflare plugin
- `tsconfig.json` - TypeScript configuration
- `deploy.config.json` - cf-deploy configuration

## Features

- Full SSR with TanStack Start
- File-based routing with TanStack Router
- Server functions running on Cloudflare Workers
- Modern CSS with dark mode support
- Deployed via cf-deploy CLI

## Quick Start

### 1. Install Dependencies

```bash
cd examples/tanstack-start
npm install
```

### 2. Development

```bash
npm run dev
```

Open <http://localhost:3000> to see the app.

### 3. Build

```bash
npm run build
```

This generates:

- `.output/client/` - Static assets
- `.output/server/` - SSR worker code

### 4. Deploy

```bash
# Set API token
export CF_API_TOKEN=your-token

# Deploy (creates new project)
npm run deploy -- --create-project

# Or with PowerShell
$env:CF_API_TOKEN="your-token"
npm run deploy -- --create-project
```

## Project Structure

```text
tanstack-start/
├── src/
│   ├── components/
│   │   ├── DefaultCatchBoundary.tsx
│   │   └── NotFound.tsx
│   ├── routes/
│   │   ├── __root.tsx        # Root layout
│   │   ├── index.tsx         # Home page
│   │   ├── about.tsx         # About page
│   │   └── api-demo.tsx      # API demo page
│   ├── styles/
│   │   └── app.css           # Global styles
│   └── router.tsx            # Router config
├── scripts/
│   └── deploy.js             # Deploy helper
├── deploy.config.json        # cf-deploy config
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Routes

| Route       | Description                                |
| ----------- | ------------------------------------------ |
| `/`         | Home page with server-loaded data          |
| `/about`    | About page explaining the deployment       |
| `/api-demo` | Interactive API demo with server functions |

## Server Functions

TanStack Start uses `createServerFn` for server-side code:

```typescript
const getServerData = createServerFn({ method: 'GET' }).handler(async () => {
  return {
    message: 'Hello from the server!',
    timestamp: new Date().toISOString(),
  };
});
```

These functions run on Cloudflare Workers and can access bindings, environment variables, and Workers APIs.

## Configuration

### deploy.config.json

```json
{
  "assets": {
    "directory": "./.output/client"
  },
  "server": {
    "entrypoint": "index.js",
    "modulesDirectory": "./.output/server"
  },
  "run_worker_first": true
}
```

- **run_worker_first: true** - All requests go through the SSR worker

## Learn More

- [TanStack Start Documentation](https://tanstack.com/start/latest)
- [TanStack Router Documentation](https://tanstack.com/router/latest)
- [CLI Documentation](../../cli/README.md)
