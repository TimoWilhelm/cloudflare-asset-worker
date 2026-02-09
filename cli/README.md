# Cloudflare Asset Worker CLI

A command-line tool for automated deployment of applications to the Cloudflare Multi-Project Platform. This CLI reads a configuration file to determine asset locations, server-side modules, and deployment settings, then automatically handles the entire deployment process.

## Features

- **Configuration-based deployment** - Define your deployment in a simple JSON config file
- **Automatic asset scanning** - Recursively scans directories with glob pattern support
- **Server-side code deployment** - Deploy JavaScript/Python modules with automatic discovery
- **Three-phase upload flow** - Efficient content-addressed uploads with deduplication
- **Environment variable support** - Use ${ENV_VAR} syntax in config files
- **Immutable deployments** - Each deploy creates a new project (no redeploys)
- **Project management** - List and manage deployed projects
- **Dry run mode** - Preview deployments before executing

## Installation

From the workspace root:

```bash
npm install
```

The CLI will be available as `cf-deploy` in your workspace.

## Quick Start

### 1. Initialize Configuration

Create a deployment configuration file:

```bash
npx cf-deploy init
```

This creates a `deploy.config.json` file with example configuration.

### 2. Configure Your Deployment

Edit `deploy.config.json`:

```json
{
  "projectName": "My Application",
  "assets": {
    "directory": "./dist",
    "patterns": ["**/*"],
    "ignore": ["**/*.map"]
  },
  "server": {
    "entrypoint": "index.js",
    "modulesDirectory": "./server",
    "compatibilityDate": "2025-11-09"
  },
  "config": {
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application",
    "redirects": {
      "static": {},
      "dynamic": {}
    },
    "headers": {
      "rules": {}
    }
  },
  "run_worker_first": ["/api/*"],
  "env": {
    "ENVIRONMENT": "production"
  }
}
```

### 3. Set API Token

Set your API token as an environment variable:

```bash
# Windows (PowerShell)
$env:CF_API_TOKEN="your-api-token"

# Windows (CMD)
set CF_API_TOKEN=your-api-token

# Linux/Mac
export CF_API_TOKEN=your-api-token
```

### 4. Deploy

Deploy your application (a new immutable project is created each time):

```bash
npx cf-deploy deploy
```

## Commands

### `deploy`

Deploy an application based on the configuration file.

```bash
npx cf-deploy deploy [options]
```

**Options:**

- `-c, --config <path>` - Path to configuration file (default: `deploy.config.json`)
- `--api-token <token>` - API token for authentication (or use CF_API_TOKEN env var)
- `--router-url <url>` - Router URL (or use CF_ROUTER_URL env var, default: <http://127.0.0.1:8787>)
- `--dry-run` - Show what would be deployed without actually deploying

Each deploy creates a new immutable project. To update an application, deploy again and switch traffic to the new project.

**Examples:**

```bash
# Deploy using default config
npx cf-deploy deploy

# Deploy with custom config
npx cf-deploy deploy -c production.config.json

# Dry run to preview deployment
npx cf-deploy deploy --dry-run
```

### `list`

List all projects.

```bash
npx cf-deploy list [options]
```

**Options:**

- `--api-token <token>` - API token for authentication (or use CF_API_TOKEN env var)
- `--router-url <url>` - Router URL (or use CF_ROUTER_URL env var, default: <http://127.0.0.1:8787>)

**Example:**

```bash
npx cf-deploy list
```

### `init`

Initialize a new deployment configuration file.

```bash
npx cf-deploy init [options]
```

**Options:**

- `-o, --output <path>` - Output path for config file (default: `deploy.config.json`)

**Example:**

```bash
npx cf-deploy init -o staging.config.json
```

## Configuration Reference

### Required Fields

- **`projectName`** (string) - Name of the project. A new immutable project is created for each deployment.

### Optional Fields

#### `assets`

Configuration for static assets:

```json
{
  "directory": "./dist",
  "patterns": ["**/*"],
  "ignore": ["**/*.map", "**/.DS_Store"]
}
```

- **`directory`** (string) - Directory containing static assets (relative to config file)
- **`patterns`** (array) - Glob patterns to include (default: `["**/*"]`)
- **`ignore`** (array) - Glob patterns to exclude (default: `[]`)

> **Note:** Maximum 20,000 asset files per deployment, with each file limited to 25 MiB. Exceeding these limits will cause deployment to fail.

#### `server`

Configuration for server-side code:

```json
{
  "entrypoint": "index.js",
  "modulesDirectory": "./server",
  "compatibilityDate": "2025-11-09"
}
```

- **`entrypoint`** (string) - Main entry point module (required if using server-side code)
- **`modulesDirectory`** (string) - Directory containing server modules (required if using server-side code)
- **`compatibilityDate`** (string) - Cloudflare Workers compatibility date (default: `"2025-11-09"`)

> **Note:** Total server-side code size (all modules combined) is limited to 10 MB. Exceeding this limit will cause deployment to fail.

#### `config`

Asset serving configuration:

```json
{
  "html_handling": "auto-trailing-slash",
  "not_found_handling": "single-page-application"
}
```

- **`html_handling`** - How to handle HTML files:
  - `"auto-trailing-slash"` - Automatically add/remove trailing slashes
  - `"force-trailing-slash"` - Force trailing slashes
  - `"none"` - No automatic handling
- **`not_found_handling`** - How to handle 404 errors:
  - `"none"` - Return 404
  - `"single-page-application"` - Serve index.html for 404s
  - `"404-page"` - Serve custom 404 page

#### `redirects`

(object) - Configure URL redirects and proxying:

```json
{
  "redirects": {
    "static": {
      "/old-page": {
        "status": 301,
        "to": "/new-page"
      },
      "/proxy-asset": {
        "status": 200,
        "to": "/actual-asset.html"
      }
    },
    "dynamic": {
      "/blog/:year/:month/:slug": {
        "status": 302,
        "to": "/posts/:year-:month/:slug"
      },
      "/old/*": {
        "status": 301,
        "to": "/new/:splat"
      },
      "https://old.example.com/*": {
        "status": 301,
        "to": "https://new.example.com/:splat"
      }
    }
  }
}
```

- **`static`** - Simple path-to-path mappings (max 2,000 rules)
  - `status` - HTTP status code (200 for proxying, 301/302/303/307/308 for redirects)
  - `to` - Target path or URL
  - Precedence is automatically determined by the order of rules (first rule wins when multiple match)
- **`dynamic`** - Dynamic rules with pattern matching (max 100 rules)
  - Use `:placeholder` to capture path segments (e.g., `:slug`, `:id`)
  - Use `*` for wildcards (becomes `:splat` in the target)
  - Can specify cross-host rules with `https://domain.com/path`

**Limits:**

- Assets: Maximum 20,000 files per deployment, 25 MiB per file
- Static redirects: Maximum 2,000 rules per deployment
- Dynamic redirects: Maximum 100 rules per deployment
- Environment variables: Maximum 64 variables per deployment, 5 KB per variable
- Server-side code: Maximum 10 MB total (all modules combined)

Exceeding these limits will cause deployment to fail.

#### `headers`

(object) - Set or remove custom HTTP headers for static assets:

> **Note:** Headers are only applied to static assets served by the asset worker. For dynamic responses from server-side functions, set headers in your worker code.

```json
{
  "headers": {
    "rules": {
      "/assets/*": {
        "set": {
          "X-Served-By": "Asset Worker",
          "X-Custom-Header": "Custom Value"
        }
      },
      "/*.css": {
        "set": {
          "X-Asset-Type": "stylesheet"
        }
      },
      "/images/:filename": {
        "set": {
          "X-Image-Name": ":filename"
        }
      }
    }
  }
}
```

- **`rules`** - Object where keys are path patterns and values define headers
  - `set` - Headers to add or modify
  - `unset` - Array of header names to remove
- **Pattern matching:**
  - Use `*` for wildcards (matches any characters)
  - Use `:placeholder` to capture and reuse path segments
  - Multiple matching rules will all apply (headers are merged)
  - Can specify cross-host rules with `https://domain.com/path`
- **Common use cases:**
  - Setting custom headers for debugging or tracking
  - Adding `Cache-Control` headers for different asset types
  - Setting CORS headers for static resources

#### `run_worker_first`

(boolean | array) - Run worker before checking assets:

```json
"run_worker_first": ["/api/*", "/admin/**"]
```

- `true` - Run worker for all requests
- `false` - Check assets first (default)
- Array of glob patterns - Run worker first for matching paths

#### `env`

(object) - Environment variables for server-side code (max 64 variables, 5 KB per variable):

```json
{
  "ENVIRONMENT": "production",
  "API_URL": "https://api.example.com"
}
```

> **Note:** Each environment variable value is limited to 5 KB (5,120 bytes).

## Project Structure Examples

### Static Website

```text
my-website/
├── dist/                    # Built assets
│   ├── index.html
│   ├── about.html
│   └── css/
│       └── style.css
└── deploy.config.json
```

**Configuration:**

```json
{
  "projectName": "My Website",
  "assets": {
    "directory": "./dist"
  },
  "config": {
    "html_handling": "auto-trailing-slash"
  }
}
```

### Full-Stack Application

```text
my-app/
├── dist/                    # Frontend assets
│   ├── index.html
│   └── app.js
├── server/                  # Backend code
│   ├── index.js             # Entry point
│   └── api/
│       └── users.js
└── deploy.config.json
```

**Configuration:**

```json
{
  "projectName": "My App",
  "assets": {
    "directory": "./dist"
  },
  "server": {
    "entrypoint": "index.js",
    "modulesDirectory": "./server"
  },
  "run_worker_first": ["/api/*"],
  "config": {
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application",
    "redirects": {
      "static": {
        "/home": { "status": 301, "to": "/" }
      },
      "dynamic": {
        "/old-blog/*": { "status": 301, "to": "/blog/:splat" }
      }
    },
    "headers": {
      "rules": {
        "/assets/*": {
          "set": {
            "X-Served-By": "Asset Worker",
            "X-Asset-Path": "Static Assets"
          }
        },
        "/*.css": {
          "set": {
            "X-Asset-Type": "stylesheet"
          }
        }
      }
    }
  },
  "env": {
    "ENVIRONMENT": "production"
  }
}
```

## Server-Side Code Requirements

Server-side code must export a default object with a `fetch` handler:

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      // Handle API requests
      return new Response('API response');
    }

    // Return 404 to let assets handle other paths
    return new Response('Not found', { status: 404 });
  },
};
```

## Environment Variables

### Authentication and Connection

Set required environment variables for authentication:

```bash
# Required
export CF_API_TOKEN=your-token

# Optional (defaults to http://127.0.0.1:8787)
export CF_ROUTER_URL=https://your-worker.example.com

# Deploy
npx cf-deploy deploy
```

Alternatively, use CLI flags:

```bash
npx cf-deploy deploy --api-token your-token --router-url https://your-worker.example.com
```

### Worker Environment Variables

Use environment variable substitution in the `env` section for worker runtime variables:

```json
{
  "env": {
    "DATABASE_URL": "${DATABASE_URL}",
    "API_KEY": "${EXTERNAL_API_KEY}"
  }
}
```

Set these before deploying:

```bash
export DATABASE_URL=your-database-url
export EXTERNAL_API_KEY=your-api-key
npx cf-deploy deploy
```

## Multiple Environments

Create separate config files for different environments:

```text
project/
├── deploy.config.json          # Development
├── staging.config.json         # Staging
└── production.config.json      # Production
```

Each deploy creates a new immutable project. Old projects can be cleaned up via the `list` command and the management API.

```bash
# Development
npx cf-deploy deploy

# Staging
npx cf-deploy deploy -c staging.config.json

# Production
npx cf-deploy deploy -c production.config.json
```

## Troubleshooting

### "API token is required"

Set the `CF_API_TOKEN` environment variable or use the `--api-token` flag.

### "Assets directory not found"

Check that the `assets.directory` path is correct and relative to the config file location.

### "Entrypoint module not found"

Ensure the `server.entrypoint` file exists in the `server.modulesDirectory`.

### "Failed to create upload session"

Verify that:

1. The router worker is running
2. The `CF_ROUTER_URL` is correct (or use `--router-url` flag)
3. The API token is valid

## Development

To work on the CLI itself:

```bash
# Install dependencies
npm install

# Test the CLI locally
node bin/cli.js --help
```

## License

MIT
