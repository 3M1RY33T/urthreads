# Deployment Guide

[📘 Readme](../README.md) · [⚙️ Installation](./INSTALLATION.md) · [🛠️ Management](./MANAGEMENT.md) · [🚀 Deployment](./DEPLOYMENT.md)

This guide covers production deployment and best practices.

## Production Checklist

- [ ] Test with your actual domain(s)
- [ ] Set correct CORS origins in `ALLOWED_ORIGINS`
- [ ] Enable HTTPS (Cloudflare default)
- [ ] Set up comment moderation workflow
- [ ] Configure automated backups
- [ ] Monitor worker performance
- [ ] Document your moderation policy
- [ ] Set up email notifications for pending comments
- [ ] Review security considerations

## Deployment Steps

### 1. Configure for Production

Edit `wrangler.toml` for production environment:

```toml
[env.production]
name = "likes-and-comments-worker-prod"

[[env.production.d1_databases]]
binding = "DB"
database_name = "likes-and-comments-prod"
database_id = "your-prod-db-id"

[env.production.vars]
ALLOWED_ORIGINS = "https://mysite.com,https://www.mysite.com"
```

### 2. Create Production Database

```bash
wrangler d1 create likes-and-comments-prod
```

Initialize schema:

```bash
wrangler d1 execute likes-and-comments-prod --remote --file=src/schema.sql --env production
```

### 3. Deploy Worker

```bash
wrangler deploy --env production
```

Verify deployment:

```bash
curl "https://likes-and-comments-worker.<subdomain>.workers.dev/likes?path=/test"
```

### 4. Update Your Site

Update your website to use the production endpoint:

```html
<script>
  window.LIKES_CONFIG = {
    endpoint: 'https://likes-and-comments-worker.<subdomain>.workers.dev/likes'
  };
  window.COMMENTS_CONFIG = {
    endpoint: 'https://likes-and-comments-worker.<subdomain>.workers.dev/comments'
  };
</script>
```

## Performance & Monitoring

### Monitor Worker Performance

Access metrics in [Cloudflare Dashboard](https://dash.cloudflare.com/):
- Workers > Your Worker > Analytics
- Monitor requests, errors, CPU time

### D1 Performance

- The database includes an index on `post_comments(path, status, created_at)`
- This optimizes queries for loading approved comments by post
- For high-traffic sites, consider:
  - Adding caching headers
  - Using Cloudflare Cache API
  - Batching comment loads

### Database Optimization

Keep `post_comments` table performant:

```bash
# Remove old rejected comments (90+ days old)
wrangler d1 execute likes-and-comments-prod --remote --command \
  "DELETE FROM post_comments WHERE status = 'rejected' AND created_at < datetime('now', '-90 days')"
```

## Security Best Practices

### CORS Configuration

Always specify allowed origins, never use `*` in production:

```toml
[env.production.vars]
# ✓ Good: specific domains
ALLOWED_ORIGINS = "https://mysite.com,https://www.mysite.com"

# ✗ Bad: too permissive
ALLOWED_ORIGINS = "*"
```

### Input Validation

The worker validates all inputs:
- Post path must start with `/` (max 500 chars)
- Nickname max 80 chars
- Email max 254 chars (with format validation)
- Comment content max 2000 chars
- URL max 1000 chars

Additional spam checks:
- Comments with `website` field filled are silently rejected (bot honeypot)
- Email validation checks basic format

### Rate Limiting

Consider using Cloudflare's built-in rate limiting:

1. Go to Security > Rate Limiting
2. Create rule for `/likes` and `/comments` endpoints
3. Set threshold (e.g., 100 requests per 10 seconds)

### Database Security

- D1 is encrypted at rest
- Use Cloudflare's authentication for Admin API access
- Regular backups (see Backup Strategy below)
- Delete spam/harmful content as needed

## Backup Strategy

### Automated Backups

D1 includes automated backups. To manually backup:

```bash
# Export all data
wrangler d1 execute likes-and-comments-prod --remote --command \
  "SELECT * FROM post_likes" > prod_likes_$(date +%Y%m%d).sql

wrangler d1 execute likes-and-comments-prod --remote --command \
  "SELECT * FROM post_comments" > prod_comments_$(date +%Y%m%d).sql
```

### Backup Script

Create `backup.sh`:

```bash
#!/bin/bash

BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "Backing up likes..."
wrangler d1 execute likes-and-comments-prod --remote --command \
  "SELECT * FROM post_likes" > "$BACKUP_DIR/likes_$DATE.sql"

echo "Backing up comments..."
wrangler d1 execute likes-and-comments-prod --remote --command \
  "SELECT * FROM post_comments" > "$BACKUP_DIR/comments_$DATE.sql"

echo "Backup complete: $BACKUP_DIR/"
```

Run weekly with cron:

```bash
0 2 * * 0 cd /path/to/project && bash backup.sh
```

## Multi-environment Setup

### Development, Staging, Production

```toml
# wrangler.toml

# Development (local)
[[d1_databases]]
binding = "DB"
database_name = "likes-and-comments-dev"
database_id = "dev-id"

[vars]
ALLOWED_ORIGINS = "http://localhost:*"

# Staging
[env.staging]
name = "likes-and-comments-worker-staging"
[[env.staging.d1_databases]]
binding = "DB"
database_name = "likes-and-comments-staging"
database_id = "staging-id"

[env.staging.vars]
ALLOWED_ORIGINS = "https://staging.mysite.com"

# Production
[env.production]
name = "likes-and-comments-worker-prod"
[[env.production.d1_databases]]
binding = "DB"
database_name = "likes-and-comments-prod"
database_id = "prod-id"

[env.production.vars]
ALLOWED_ORIGINS = "https://mysite.com,https://www.mysite.com"
```

Deploy to each:

```bash
# Development
wrangler dev

# Staging
wrangler deploy --env staging

# Production
wrangler deploy --env production
```

## Scaling Considerations

### Current Limits

- Cloudflare Workers: Free tier supports unlimited requests
- D1 Database: Generous free tier quotas
- Each deployment gets own isolated worker

### When to Scale

For very high traffic (100k+ comments/day):

1. **Database**: D1 scales automatically
2. **Worker**: Automatically distributed globally
3. **Caching**: Use Cloudflare Cache API

```javascript
// Add caching to approved comments endpoint
const cacheKey = `approved-comments-${path}`;
const cached = await CACHE.match(cacheKey);
if (cached) return cached;

// Cache for 5 minutes
const response = jsonResponse(request, env, { comments });
response.headers.set('Cache-Control', 'public, max-age=300');
await CACHE.put(cacheKey, response.clone());
```

### Database Backups at Scale

For very large databases, use:

```bash
# Export with pagination
for offset in {0..1000000..100000}; do
  wrangler d1 execute likes-and-comments-prod --remote --command \
    "SELECT * FROM post_comments LIMIT 100000 OFFSET $offset" \
    >> comments_batch_$offset.sql
done
```

## Monitoring & Alerts

### Set Up Alerts

1. Go to Cloudflare Dashboard > Notifications
2. Create alert for:
   - High error rates (> 5%)
   - High CPU usage (> 80%)

### Log Analysis

Monitor worker logs:

```bash
# Stream live logs
wrangler tail --env production
```

Look for:
- Error rates
- Unusual comment patterns
- Spam submissions

### Email Notifications

Create a webhook integration:

```javascript
// In worker.js, add after successful comment creation:
if (env.WEBHOOK_URL) {
  await fetch(env.WEBHOOK_URL, {
    method: "POST",
    body: JSON.stringify({
      event: "comment_pending",
      id,
      path,
      author: nickname,
      created: new Date().toISOString()
    })
  });
}
```

## Cost Tracking

### Cloudflare Pricing

- **Workers**: Free tier includes 100,000 requests/day
- **D1**: Free tier includes 1 GB storage and queries
- **Bandwidth**: Generally free within limits

Monitor usage:

1. Go to Dashboard > Billing
2. View Workers & D1 usage
3. Set usage alerts

## Rolling Back

If deployment causes issues:

```bash
# Revert to previous worker version
wrangler rollback --env production

# Or deploy known-good version
git checkout main -- src/worker.js
wrangler deploy --env production
```

## Support & Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [D1 Documentation](https://developers.cloudflare.com/d1/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Community](https://community.cloudflare.com/)
