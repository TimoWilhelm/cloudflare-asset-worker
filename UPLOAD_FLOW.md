# Asset Upload Flow Documentation

This document describes the three-phase asset upload flow, following the Cloudflare Workers API pattern.

## Overview

The asset upload system implements the same three-phase approach as Cloudflare's official Workers API:

1. **Phase 1: Register Manifest** - Submit asset metadata and receive upload instructions
2. **Phase 2: Upload Assets** - Upload files in optimized buckets with JWT authentication
3. **Phase 3: Deploy** - Finalize deployment with completion JWT

This approach provides several benefits:

- **Deduplication**: Skip uploading files that haven't changed
- **Optimized batching**: Upload files in optimally-sized buckets
- **Security**: JWT-based authentication for upload sessions
- **Efficiency**: Only upload what's needed

## API Endpoints

### 1. Create Upload Session

**Endpoint:** `POST /__api/projects/:projectId/assets-upload-session`

**Headers:**

- `Authorization: <API_TOKEN>`
- `Content-Type: application/json`

**Request Body:**

```json
{
  "manifest": {
    "/index.html": {
      "hash": "a1b2c3d4...",
      "size": 1234
    },
    "/style.css": {
      "hash": "e5f6g7h8...",
      "size": 5678
    }
  }
}
```

**Response (200 OK):**

```json
{
  "result": {
    "jwt": "<UPLOAD_TOKEN>",
    "buckets": [
      ["a1b2c3d4...", "e5f6g7h8..."],
      ["i9j0k1l2..."]
    ]
  },
  "success": true,
  "errors": null,
  "messages": null
}
```

**Notes:**

- The `hash` must be a 64-character SHA-256 hex string
- If all files already exist (cached), `buckets` will be empty and `jwt` will be a completion token
- JWT is valid for 1 hour

### 2. Upload Assets

**Endpoint:** `POST /__api/projects/:projectId/assets/upload`

**Headers:**

- `Authorization: Bearer <UPLOAD_TOKEN>`
- `Content-Type: application/json`

**Request Body:**

```json
{
  "a1b2c3d4...": "<base64_encoded_content>",
  "e5f6g7h8...": "<base64_encoded_content>"
}
```

**Response (200 OK - More buckets pending):**

```json
{
  "result": {
    "jwt": null
  },
  "success": true,
  "errors": null,
  "messages": null
}
```

**Response (201 Created - All uploads complete):**

```json
{
  "result": {
    "jwt": "<COMPLETION_TOKEN>"
  },
  "success": true,
  "errors": null,
  "messages": null
}
```

**Notes:**

- Upload one bucket at a time in the order provided
- Files must be base64 encoded
- Content type is automatically detected from file extension
- Completion JWT is returned after the last bucket upload

### 3. Deploy Project

**Endpoint:** `POST /__api/projects/:projectId/deploy`

**Headers:**

- `Authorization: <API_TOKEN>`
- `Content-Type: application/json`

**Request Body (with completion JWT):**

```json
{
  "completionJwt": "<COMPLETION_TOKEN>",
  "serverCode": {
    "entrypoint": "index.js",
    "modules": {
      "index.js": "export default { async fetch() { ... } }"
    },
    "compatibilityDate": "2025-11-17"
  },
  "config": {
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  },
  "run_worker_first": false
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Project deployed successfully",
  "project": { ... },
  "deployedAssets": 10,
  "newAssets": 2,
  "skippedAssets": 8,
  "deployedServerCodeModules": 1,
  "newServerCodeModules": 1,
  "skippedServerCodeModules": 0
}
```

## Implementation Details

### JWT Structure

The system uses HMAC-SHA256 signed JWTs with the following payload structure:

**Upload JWT:**

```json
{
  "sessionId": "uuid",
  "projectId": "project-id",
  "phase": "upload",
  "iat": 1234567890,
  "exp": 1234571490
}
```

**Completion JWT:**

```json
{
  "sessionId": "uuid",
  "projectId": "project-id",
  "phase": "complete",
  "manifest": { ... },
  "iat": 1234567890,
  "exp": 1234571490
}
```

### Hash Calculation

Assets are identified by SHA-256 hash:

```javascript
const crypto = require('crypto');
const hash = crypto.createHash('sha256')
  .update(fileContent)
  .digest('hex');
```

The hash must be exactly 64 hexadecimal characters (32 bytes).

### Bucket Creation

Files are automatically grouped into buckets with a maximum of 10 files per bucket for optimal upload performance. This batching:

- Reduces number of HTTP requests
- Maintains manageable payload sizes
- Allows progress tracking

### Content Type Detection

Content types are automatically detected from file extensions:

| Extension | Content Type |
|-----------|-------------|
| `.html` | `text/html` |
| `.css` | `text/css` |
| `.js` | `application/javascript` |
| `.json` | `application/json` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.svg` | `image/svg+xml` |
| `.woff`, `.woff2` | `font/woff`, `font/woff2` |

And many more (see `guessContentType` method in `worker.ts`).

## Error Handling

### Common Errors

**400 Bad Request:**

- Invalid manifest format
- Hash not found in manifest
- Invalid hash format

**401 Unauthorized:**

- Missing or invalid API token
- Invalid or expired JWT
- JWT phase mismatch
- JWT project ID mismatch

**404 Not Found:**

- Project not found
- Session expired or not found

## Example Usage

All examples in the `examples/` directory now automatically use the three-phase upload flow through the `deployApplication()` function in `shared-utils.js`.

### Quick Start

Run any of the existing examples:

```bash
# Deploy a full-stack application
node examples/deploy-example.js

# Deploy a static site
node examples/static-site-example.js
```

Both examples will:

1. Automatically create a manifest from your assets
2. Start an upload session and receive buckets
3. Upload files in optimized batches
4. Finalize deployment with the completion JWT

You'll see progress output showing each phase.

## Comparison with Cloudflare API

This implementation closely mirrors the official Cloudflare Workers API:

| Cloudflare API | This Implementation |
|----------------|---------------------|
| `/accounts/:accountId/workers/scripts/:scriptName/assets-upload-session` | `/__api/projects/:projectId/assets-upload-session` |
| `/accounts/:accountId/workers/assets/upload?base64=true` | `/__api/projects/:projectId/assets/upload` (base64 in JSON body) |
| `/accounts/:accountId/workers/scripts/:scriptName` | `/__api/projects/:projectId/deploy` |

### Key Differences

1. **Base64 encoding**: Cloudflare uses multipart form data, we use JSON with base64 strings
2. **Endpoint structure**: Simplified for single-tenant usage
3. **Authentication**: Uses simple API token instead of OAuth
4. **Session storage**: Uses KV with 1-hour TTL

## Legacy Support

The deployment endpoint still supports the legacy single-phase upload for backward compatibility:

```json
{
  "assets": [
    {
      "pathname": "/index.html",
      "content": "<base64>",
      "contentType": "text/html"
    }
  ]
}
```

However, the three-phase approach is recommended for:

- Better performance
- Reduced bandwidth usage
- Improved reliability
- Progress tracking

## Security Considerations

1. **JWT Secret**: Set a strong `JWT_SECRET` environment variable
2. **API Token**: Keep your `API_TOKEN` secure
3. **HTTPS**: Always use HTTPS in production
4. **Expiration**: JWTs expire after 1 hour
5. **Session cleanup**: Sessions automatically expire after 1 hour via KV TTL

## Configuration

Add to your `.env.local`:

```txt
JWT_SECRET="your-secret-key-change-in-production"
API_TOKEN="your-api-token"
```

Or use secrets for production:

```bash
wrangler secret put JWT_SECRET
wrangler secret put API_TOKEN
```

## Performance Tips

1. **Manifest optimization**: Only include changed files in manifest
2. **Parallel uploads**: Upload buckets sequentially, but process files in parallel where possible
3. **Caching**: The system automatically skips uploading unchanged files
4. **Bucket size**: Default 10 files per bucket balances performance and reliability
5. **Compression**: Consider compressing files before upload (e.g., gzip for text files)

## Troubleshooting

### "Session expired or not found"

- JWTs are valid for 1 hour
- Sessions are stored in KV with 1-hour TTL
- Complete the upload flow within the time limit

### "Invalid or expired JWT"

- Check JWT_SECRET is configured correctly
- Ensure JWT hasn't expired
- Verify you're using the correct JWT for the phase

### "Hash not found in manifest"

- Ensure you're uploading only hashes from the registered manifest
- Check that hash calculation matches (SHA-256, 64 hex chars)

### Upload failures

- Check network connectivity
- Verify file sizes are within limits
- Ensure base64 encoding is correct
- Check KV namespace quotas
