# <picture><source srcset="https://drive.google.com/uc?export=view&id=1XCmiWW-Rvx7hb4qMBtHVLd1NTv19gi1T" media="(prefers-color-scheme: dark)"><img align="left" width="50" src="https://drive.google.com/uc?export=view&id=174ewRh9Rib_S9wmywx_zg0eDP0TIrJVD" alt=""></picture> thread-cf

[📘 Readme](#cloudflare-likes--comments) · [⚙️ Installation](./docs/INSTALLATION.md) · [🛠️ Management](./docs/MANAGEMENT.md) · [🚀 Deployment](./docs/DEPLOYMENT.md)

A lightweight, open-source engagement system for static websites. Add likes and moderated comments to any website—personal blogs, documentation, or portfolios—backed by Cloudflare Workers and D1 database.

**Zero server infrastructure. No databases to manage. Works everywhere.**


## Features

- **Likes System**: Track post popularity with browser-local deduplication
- **Moderated Comments**: Comments stored as pending until approved
- **Global Deployment**: Cloudflare Workers deployed worldwide
- **Lightweight Security**: Input validation, CORS protection, spam honeypot
- **Simple Management**: CLI tool for approving/rejecting comments
- **Framework Agnostic**: Works with Jekyll, Next.js, plain HTML, and other static sites
- **Static Site Friendly**: No build step required, just add a script tag
- **Deploy in Minutes**: Simple setup with Cloudflare account

## Quick Start

1. Create your Cloudflare D1 database.
2. Initialize the database schema from `src/schema.sql`.
3. Run `npm run setup:env` locally, or `thread-cf setup-env` after installing the package, to create a local `.env` file.
4. Copy `config/wrangler.toml.example` to `wrangler.toml`, configure your account and D1 bindings, then deploy.
5. Add the client scripts to your site and set `window.LIKES_CONFIG` / `window.COMMENTS_CONFIG`.

For detailed setup: see [Installation Guide](./docs/INSTALLATION.md)

## Installation & Setup

This repository contains a full setup guide in `docs/INSTALLATION.md`.

- `docs/INSTALLATION.md` — full install, Wrangler config, D1 setup, local testing, and troubleshooting
- `docs/MANAGEMENT.md` — comment moderation, CLI usage, and D1 queries
- `docs/DEPLOYMENT.md` — production deployment, backup strategy, and monitoring

For a concise quick start, follow the steps under the **Quick Start** section above.

## How It Works

### Likes Flow

```
User clicks like button
  ↓
Client checks browser localStorage (prevent duplicates)
  ↓
POST request to /likes endpoint
  ↓
Worker increments count in D1
  ↓
Returns updated count
  ↓
Button disables, count updates
```

### Comments Flow

```
User submits comment
  ↓
Modal asks for name & email
  ↓
POST request to /comments endpoint
  ↓
Worker stores as "pending" in D1
  ↓
You approve via CLI: thread-cf approve 5
  ↓
Comment visible on next page load
```

## Usage

### Add Likes

HTML setup:

```html
<button 
  data-like-button 
  data-path="/blog/my-post"
>
  ❤️ Like (<span data-like-count>0</span>)
</button>

<script>
  window.LIKES_CONFIG = {
    endpoint: 'https://your-worker.workers.dev/likes'
  };
</script>
<script src="/path/to/likes.js"></script>
```

Key attributes:
- `data-like-button`: Identifies this as a like button
- `data-path`: Post identifier (must start with `/`)
- `data-like-count`: Element for displaying count

### Add Comments

HTML setup:

```html
<div 
  data-worker-comments
  data-page-id="/blog/my-post"
  data-page-url="https://mysite.com/blog/my-post"
  data-page-title="My Post Title"
>
  <div data-comment-list></div>
  <div data-comment-status></div>
  
  <form data-comment-draft-form>
    <textarea name="content" placeholder="Your comment..."></textarea>
    <button type="submit" data-comment-send>Post</button>
  </form>

  <div data-comment-modal hidden>
    <div class="modal-content">
      <h3>Before posting</h3>
      <form data-comment-identity-form>
        <input type="text" name="nickname" placeholder="Your name" required />
        <input type="email" name="email" placeholder="Email (optional)" />
        <button type="button" data-comment-cancel>Cancel</button>
        <button type="submit">Submit</button>
      </form>
    </div>
  </div>
</div>

<script>
  window.COMMENTS_CONFIG = {
    endpoint: 'https://your-worker.workers.dev/comments'
  };
</script>
<script src="/path/to/comments.js"></script>
```

See [examples/](./examples/) for complete HTML with styling.

### Manage Comments

For comment moderation and D1 SQL examples, see `docs/MANAGEMENT.md`.

- `docs/MANAGEMENT.md` — CLI commands, comment/like CRUD, pending/approved/rejected workflows, bulk operations, backups, and advanced queries

### Admin Dashboard

See [dashboard/index.html](./dashboard/index.html) for the built-in static dashboard that connects to protected Worker admin endpoints.

Set an admin key before using it:

```bash
thread-cf admin-key
wrangler secret put ADMIN_API_KEY
```

The generator writes `ADMIN_API_KEY` and `ADMIN_API_KEY_EXPIRES_AT` to your local `.env`, replacing the existing key if present. The dashboard can review pending comments, approve or reject comments, inspect ranked liked/commented paths, and view the current Worker configuration returned by `/admin/worker`.

## Integration Examples

### Jekyll Blog

See [examples/jekyll/post-layout.html](./examples/jekyll/post-layout.html)

Copy to `_layouts/post.html` and configure:

```yaml
# _config.yml
likes:
  endpoint: https://your-worker.workers.dev/likes
comments:
  endpoint: https://your-worker.workers.dev/comments
```

### Standalone HTML

See [examples/standalone-html/index.html](./examples/standalone-html/index.html)

- [Like + Comment example](./examples/standalone-html/index.html)
- [Like-only example](./examples/standalone-html/likes-only.html)
- [Comment-only example](./examples/standalone-html/comments-only.html)

Simple HTML pages with likes and/or comments support—no framework needed.

### Admin Dashboard

Open [dashboard/index.html](./dashboard/index.html), enter your Worker URL and `ADMIN_API_KEY` when prompted, then manage comments and likes from one page. The dashboard keeps credentials only for the current browser session and prompts again if the admin session expires.

### Next.js / React

```jsx
// In a component
import { useEffect } from 'react';

export default function BlogPost() {
  useEffect(() => {
    window.LIKES_CONFIG = {
      endpoint: 'https://your-worker.workers.dev/likes'
    };
    window.COMMENTS_CONFIG = {
      endpoint: 'https://your-worker.workers.dev/comments'
    };
    
    // Load scripts
    const likesScript = document.createElement('script');
    likesScript.src = '/likes.js';
    document.body.appendChild(likesScript);
    
    const commentsScript = document.createElement('script');
    commentsScript.src = '/comments.js';
    document.body.appendChild(commentsScript);
  }, []);

  return (
    <article>
      <h1>My Post</h1>
      <p>Content...</p>
      
      <button data-like-button data-path="/my-post">
        ❤️ Like (<span data-like-count>0</span>)
      </button>
    </article>
  );
}
```

## Deployment

A full production deployment guide is available at `docs/DEPLOYMENT.md`.

- `docs/DEPLOYMENT.md` — production Wrangler env setup, D1 provisioning, verification, monitoring, backups, and security best practices

## API Reference

### Likes Endpoint

**GET** `/likes?path=/post-url`

Returns current like count.

Request:
```
GET https://worker.dev/likes?path=/blog/my-post
```

Response:
```json
{
  "path": "/blog/my-post",
  "count": 42
}
```

**POST** `/likes?path=/post-url`

Increment like count.

Request:
```
POST https://worker.dev/likes?path=/blog/my-post
```

Response:
```json
{
  "path": "/blog/my-post",
  "count": 43
}
```

### Comments Endpoint

**GET** `/comments?path=/post-url`

Returns approved comments for a post. Each comment may include nested `replies`, `parentId`, and `likesCount`.

Request:
```
GET https://worker.dev/comments?path=/blog/my-post
```

Response:
```json
{
  "path": "/blog/my-post",
  "comments": [
    {
      "id": 1,
      "authorName": "Alice",
      "content": "Great post!",
      "createdAt": "2024-12-19T10:30:00Z",
      "likesCount": 3,
      "parentId": null,
      "replies": [
        {
          "id": 2,
          "authorName": "Bob",
          "content": "I agree!",
          "createdAt": "2024-12-19T11:00:00Z",
          "likesCount": 1,
          "parentId": 1,
          "replies": []
        }
      ]
    }
  ]
}
```

**POST** `/comments`

Submit a new comment or reply (stored as pending).

Request:
```json
{
  "path": "/blog/my-post",
  "pageUrl": "https://mysite.com/blog/my-post",
  "pageTitle": "My Post",
  "nickname": "Alice",
  "email": "alice@example.com",
  "content": "Great post!",
  "parentId": 1
}
```

Response:
```json
{
  "id": 2,
  "path": "/blog/my-post",
  "status": "pending",
  "parentId": 1
}
```

### Comment Like Endpoint

**POST** `/comments/like?commentId=123`

Increment the like count for a comment.

Response:
```json
{
  "commentId": 123,
  "likes": 4
}
```

### Admin Endpoints

Admin endpoints require either `Authorization: Bearer <ADMIN_API_KEY>` or `X-Admin-Key: <ADMIN_API_KEY>`.
If `ADMIN_API_KEY_EXPIRES_AT` is set to a past ISO timestamp, admin requests are rejected.

**GET** `/admin/summary`

Returns page likes, comment likes, comment status counts, and recent pending comments.

**GET** `/admin/comments?status=pending&limit=50`

Returns comments for moderation. `status` can be `pending`, `approved`, `rejected`, or `all`.

**POST** `/admin/comments/approve`

```json
{ "id": 5 }
```

**POST** `/admin/comments/reject`

```json
{ "id": 5 }
```

**GET** `/admin/likes?sort=relevance&direction=desc&path=/blog&limit=25`

Returns paths with likes/comment counts for the dashboard. `sort` can be `relevance`, `likes`, `comments`, or `recent`; relevance is `likes + comments * 1.5`. `direction` can be `desc` or `asc`, and `path` filters by matching post path text.

**GET** `/admin/worker`

Returns the current Worker URL and configured metadata. Cloudflare account-wide Worker listings should be proxied server-side rather than fetched from browser code.

**GET** `/admin/audit-logs?limit=25`

Returns recent protected dashboard activity. Audit entries include action, method, path, response status, client IP, user agent, timestamp, sanitized details, and a short admin-key fingerprint. Raw admin keys and request bodies are not stored.

**GET** `/comments/like?commentId=123`

Returns current like count for a comment.

Response:
```json
{
  "commentId": 123,
  "likes": 4
}
```

## Database Schema

### post_likes

```sql
CREATE TABLE post_likes (
  path TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### post_comments

```sql
CREATE TABLE post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  page_url TEXT NOT NULL,
  page_title TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT,
  author_website TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX post_comments_path_status_created_idx
  ON post_comments (path, status, created_at);
```

### admin_audit_logs

```sql
CREATE TABLE admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  admin_key_fingerprint TEXT,
  client_ip TEXT,
  user_agent TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Configuration

### Required

- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins
  ```
  ALLOWED_ORIGINS=https://mysite.com,https://www.mysite.com
  ```

### Optional

- `MAX_COMMENTS_PER_POST`: Maximum comments returned per post (default: 100)

## Security

### Built-in Protections

- **CORS validation:** Only requests from allowed origins accepted
- **Input validation:** Path, text, email checks
- **Comment spam honeypot:** Website field silently rejects (bot pattern)
- **Email validation:** Basic format checking
- **Content limits:** Max lengths prevent abuse
- **Comment moderation:** All comments require approval

### Recommendations

- Use HTTPS (Cloudflare default)
- Set specific CORS origins in production
- Monitor pending comments regularly
- Use Cloudflare rate limiting for high-traffic sites
- Archive/delete old rejected comments

## Limitations

- Like deduplication is browser-based (not IP-based)
- Comments require manual approval
- Maximum 100 comments returned per post
- Path identifiers limited to 500 chars

## Troubleshooting

### Likes not saving
- Check endpoint URL in browser console
- Verify CORS origins in `ALLOWED_ORIGINS`
- Ensure localStorage is enabled in browser

### Comments not loading
- Verify comments have `status = 'approved'` in database
- Check endpoint configuration
- See [Management Guide](./docs/MANAGEMENT.md) to approve comments

### CORS errors
- Add your domain to `ALLOWED_ORIGINS`
- Redeploy worker: `wrangler deploy`

### Database errors
- Verify schema was initialized: `wrangler d1 execute likes-and-comments --remote --file=src/schema.sql`
- Check D1 binding in `wrangler.toml`

See [Installation Guide](./docs/INSTALLATION.md) for detailed troubleshooting.

## Advanced Topics

### Production Deployment
See [Deployment Guide](./docs/DEPLOYMENT.md) for:
- Multi-environment setup
- Performance monitoring
- Backup strategies
- Scaling considerations

### Comment Management
See [Management Guide](./docs/MANAGEMENT.md) for:
- Bulk operations
- Spam detection
- Database maintenance
- Automation examples

### Custom Styling

The client scripts add these classes/data attributes you can style:

Like button:
- `.is-liked`: Button has been liked
- `[disabled]`: Button is disabled

Comment item:
- `.comment-item`: Container
- `.comment-meta`: Author and date
- `.comment-body`: Comment text
- `.comment-empty`: No comments message

Modal:
- `[data-comment-modal][hidden]`: Modal is hidden
- `.modal-content`: Modal content area

Status messages:
- `.is-error`: Error message styling

## Contributing

Contributions are welcome! Thank you for improving thread-cf

## License

MIT - See [LICENSE](./LICENSE) for details

## Inspiration

This project was inspired by and built from the implementation in [3M1RY33T/3M1RY33T.github.io](https://github.com/3M1RY33T/3M1RY33T.github.io).

---

Questions? Start with the [Installation Guide](./docs/INSTALLATION.md) or check [examples/](./examples/).
