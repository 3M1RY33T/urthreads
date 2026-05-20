# Installation & Setup Guide

[📘 Readme](../README.md) · [⚙️ Installation](./INSTALLATION.md) · [🛠️ Management](./MANAGEMENT.md) · [🚀 Deployment](./DEPLOYMENT.md)

## Prerequisites

- [Cloudflare Account](https://dash.cloudflare.com/) (free tier works)
- [Node.js](https://nodejs.org/) 16+ installed
- [Cloudflare CLI (Wrangler)](https://developers.cloudflare.com/workers/wrangler/)

## Quick Start (5 minutes)

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### 2. Create D1 Database

```bash
wrangler d1 create likes-and-comments
```

Save the database ID it shows you.

### 3. Initialize Database Schema

```bash
wrangler d1 execute likes-and-comments --remote --file=src/schema.sql
```

### 4. Configure Worker

Create your local `.env` file with the guided setup:

```bash
npm run setup:env
```

If you installed the package globally, use:

```bash
cflc setup-env
```

The setup command walks through Cloudflare account details, D1 database values, Worker URLs, CORS origins, and client endpoint URLs. It writes `.env`, which is ignored by Git.

Copy and configure the Wrangler config:

```bash
cp config/wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml`:
- Replace `account_id` with your Cloudflare account ID
- Replace `database_id` with the ID from step 2
- Set `ALLOWED_ORIGINS` to your domain(s)

### 5. Deploy Worker

```bash
wrangler deploy
```

Your worker is now live! You'll see the URL:
```
https://likes-and-comments-worker.<subdomain>.workers.dev
```

### 6. Use in Your Website

Add to your HTML (replace with your worker URL):

```html
<!-- Configure endpoints -->
<script>
  window.LIKES_CONFIG = {
    endpoint: 'https://likes-and-comments-worker.<subdomain>.workers.dev/likes'
  };
  window.COMMENTS_CONFIG = {
    endpoint: 'https://likes-and-comments-worker.<subdomain>.workers.dev/comments'
  };
</script>

<!-- Load the client scripts -->
<script src="/path/to/likes.js"></script>
<script src="/path/to/comments.js"></script>
```

Then add to your HTML elements:

```html
<!-- Like button -->
<button data-like-button data-path="/my-post">
  ❤️ Like (<span data-like-count>0</span>)
</button>

<!-- Comments section -->
<div 
  data-worker-comments
  data-page-id="/my-post"
  data-page-url="https://mysite.com/my-post"
  data-page-title="My Post Title"
>
  <!-- Comments UI goes here (see examples/) -->
</div>
```

## Detailed Setup

### Cloudflare Account Setup

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Find your **Account ID** (under Account > Workers)
3. Create an **API Token**:
   - User Profile > API Tokens > Create Token
   - Use "Edit Cloudflare Workers" template
   - Copy the token

### Configure Environment

Create `.env` with the guided CLI:

```bash
npm run setup:env
```

Or, after installing the package globally:

```bash
cflc setup-env
```

Or copy the template manually:

```bash
cp .env.example .env
```

Edit `.env`:

```env
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
D1_DATABASE_NAME=likes-and-comments
D1_DATABASE_ID=your_database_id
WORKER_NAME=likes-and-comments-worker
WORKER_URL=https://likes-and-comments-worker.<subdomain>.workers.dev
ALLOWED_ORIGINS=https://mysite.com,https://www.mysite.com
LIKES_ENDPOINT=https://likes-and-comments-worker.<subdomain>.workers.dev/likes
COMMENTS_ENDPOINT=https://likes-and-comments-worker.<subdomain>.workers.dev/comments
```

### Multiple Environments (Optional)

For production and staging:

```bash
# Deploy to production
wrangler deploy --env production

# Deploy to staging
wrangler deploy --env staging
```

Wrangler automatically uses the environment-specific settings from `wrangler.toml`.

## Testing Locally

### Test the Worker Locally

```bash
wrangler dev
```

This starts a local development server at `http://localhost:8787`.

Test the endpoints:

```bash
# Test likes GET
curl "http://localhost:8787/likes?path=/test-post"

# Test likes POST
curl -X POST "http://localhost:8787/likes?path=/test-post"

# Test comments GET
curl "http://localhost:8787/comments?path=/test-post"

# Test comments POST
curl -X POST http://localhost:8787/comments \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/test-post",
    "pageUrl": "https://example.com/test-post",
    "pageTitle": "Test Post",
    "nickname": "Test User",
    "email": "test@example.com",
    "content": "This is a test comment"
  }'
```

### Test Client-Side

1. Open `examples/standalone-html/index.html` in your browser
2. Update the endpoint URLs in the HTML
3. Test likes and comments

## Configuration Details

### Environment Variables

#### ALLOWED_ORIGINS
Comma-separated list of allowed request origins. Use `*` to allow all (not recommended).

```env
# Single origin
ALLOWED_ORIGINS=https://mysite.com

# Multiple origins
ALLOWED_ORIGINS=https://mysite.com,https://www.mysite.com,https://blog.mysite.com

# Development with localhost
ALLOWED_ORIGINS=https://mysite.com,http://localhost:3000,http://localhost:8000

# Allow all (not recommended)
ALLOWED_ORIGINS=*
```

#### ADMIN_API_KEY
Optional secret for the admin dashboard and protected admin endpoints.

```bash
wrangler secret put ADMIN_API_KEY
```

The static dashboard sends this value as a bearer token when calling `/admin/*` endpoints. Do not store it in `wrangler.toml` or commit it to the repository.

#### D1 Database

The database requires the schema from `src/schema.sql`:

- `post_likes`: Stores like counts by post path
- `post_comments`: Stores all comments (pending, approved, rejected)

## Common Issues

### "D1 binding DB is not configured"

Make sure:
1. `wrangler.toml` has the correct database_id
2. You ran `wrangler d1 execute likes-and-comments --remote --file=src/schema.sql`
3. The database exists in your Cloudflare account

### CORS Errors in Browser

1. Check browser console for origin and error message
2. Add the origin to `ALLOWED_ORIGINS` in `wrangler.toml`
3. Redeploy: `wrangler deploy`

### Comments Not Loading

1. Check that `COMMENTS_ENDPOINT` is set correctly
2. Verify comments have `status = 'approved'` in database
3. See [Management Guide](./MANAGEMENT.md) to approve comments

### Likes Not Saving

1. Verify the worker endpoint is accessible
2. Check browser console for fetch errors
3. Ensure localStorage is enabled in browser

## Next Steps

- See [Management Guide](./MANAGEMENT.md) for moderation commands
- See [Deployment Guide](./DEPLOYMENT.md) for production setup
- Check `examples/` folder for integration examples
