# Static Site Example

A simple static website demonstrating asset-only deployment.

## What's Included

- `public/index.html` - Homepage
- `public/about.html` - About page
- `public/styles.css` - Shared styling
- `deploy.config.json` - Deployment configuration

## Features

- Multiple HTML pages
- CSS styling with gradient background
- Clean navigation
- No server-side code required

## Deploy

```bash
# Deploy (creates new project)
cf-deploy deploy --api-token your-token --create-project

# Or use the project from config
cf-deploy deploy --api-token your-token
```

## Configuration

The `deploy.config.json` configures:

- **Assets**: Serves all files from `./public`
- **HTML Handling**: Auto-adds trailing slashes
- **Not Found**: Returns 404 (no fallback)

## After Deployment

Visit your deployed site at the URL shown in the deployment output. You'll see:

- Homepage with welcome message
- Link to About page
- Modern gradient design

## Next Steps

- Modify HTML and CSS in `public/`
- Redeploy to see changes: `cf-deploy deploy --api-token your-token`
- Add more pages by creating new `.html` files
