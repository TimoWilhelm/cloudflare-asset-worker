# Quick Start Guide

Get started with the `cf-deploy` CLI in 5 minutes.

## Prerequisites

1. Workers are deployed and running
2. API token is configured in the router worker

## Installation

From the workspace root:

```bash
bun install
```

## Step 1: Initialize Configuration

```bash
cd your-project
cf-deploy init
```

This creates `deploy.config.json` in your current directory.

## Step 2: Configure

Edit `deploy.config.json`:

```json
{
  "projectName": "My App",
  "assets": {
    "directory": "./dist"
  }
}
```

## Step 3: Set API Token

Use `--api-token` when running commands.

## Step 4: Deploy

Each deploy creates a new immutable project:

```bash
cf-deploy deploy --api-token your-token
```

## What's Next?

- **Add server-side code**: Configure `server` in your config to deploy backend logic
- **Multiple environments**: Create separate config files for dev/staging/production
- **Advanced routing**: Use `run_worker_first` to control request handling
- **Environment variables**: Add `env` section for runtime configuration

See [README.md](./README.md) for full documentation and [examples/](./examples/) for more usage patterns.
