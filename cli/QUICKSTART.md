# Quick Start Guide

Get started with the `cf-deploy` CLI in 5 minutes.

## Prerequisites

1. Workers are deployed and running
2. API token is configured in the router worker

## Installation

From the workspace root:

```bash
npm install
```

## Step 1: Initialize Configuration

```bash
cd your-project
npx cf-deploy init
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

```bash
# Windows PowerShell
$env:CF_API_TOKEN="your-token"

# Linux/Mac
export CF_API_TOKEN=your-token
```

## Step 4: Deploy

Each deploy creates a new immutable project:

```bash
npx cf-deploy deploy
```

## What's Next?

- **Add server code**: Configure `serverCode` in your config to deploy backend logic
- **Multiple environments**: Create separate config files for dev/staging/production
- **Advanced routing**: Use `run_worker_first` to control request handling
- **Environment variables**: Add `env` section for runtime configuration

See [README.md](./README.md) for full documentation and [examples/](./examples/) for more usage patterns.
