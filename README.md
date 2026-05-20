# Cloudflare Likes & Comments

[📘 Readme](#cloudflare-likes--comments) · [⚙️ Installation](./docs/INSTALLATION.md) · [🛠️ Management](./docs/MANAGEMENT.md) · [🚀 Deployment](./docs/DEPLOYMENT.md)

A lightweight, open-source engagement system for static websites. Add likes and moderated comments to any website—personal blogs, documentation, or portfolios—backed by Cloudflare Workers and D1 database.

**Zero server infrastructure. No databases to manage. Works everywhere.**


## Features

- 👍 **Likes System**: Track post popularity with browser-local deduplication
- 💬 **Moderated Comments**: Comments stored as pending until approved
- 🌍 **Global Deployment**: Cloudflare Workers deployed worldwide
- 🔒 **Lightweight Security**: Input validation, CORS protection, spam honeypot
- 📊 **Simple Management**: CLI tool for approving/rejecting comments
- 🎯 **Framework Agnostic**: Works with Jekyll, Next.js, plain HTML, and other static sites
- 📝 **Static Site Friendly**: No build step required, just add a script tag
- 🚀 **Deploy in Minutes**: Simple setup with Cloudflare account

## Quick Start

1. Create your Cloudflare D1 database.
2. Initialize the database schema from `src/schema.sql`.
3. Run `npm run setup:env` locally, or `cflc setup-env` after installing the package, to create a local `.env` file.
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
You approve via CLI: cflc approve 5
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

- `docs/MANAGEMENT.md` — CLI commands, pending/approved/rejected workflows, bulk operations, backups, and advanced queries

### Admin Dashboard

See [examples/admin-dashboard/index.html](./examples/admin-dashboard/index.html) for a static dashboard that connects to protected Worker admin endpoints.

Set an admin key before using it:

```bash
wrangler secret put ADMIN_API_KEY
```

The dashboard can review pending comments, approve or reject comments, inspect top liked paths, and view the current Worker configuration returned by `/admin/worker`.

## Project Structure

```
├── src/
│   ├── worker.js          # Cloudflare Worker implementation
│   ├── schema.sql         # D1 database schema
│   ├── cli.js             # Comment management CLI
│   └── setup-env.js       # Guided .env setup CLI
├── client/
│   ├── likes.js           # Client-side likes script
│   └── comments.js        # Client-side comments script
├── examples/
│   ├── admin-dashboard/   # Static admin dashboard
│   ├── jekyll/            # Jekyll blog integration
│   └── standalone-html/   # Plain HTML example
├── config/
│   ├── wrangler.toml.example  # Wrangler configuration template
│   └── .env.example           # Environment variables template
├── docs/
│   ├── INSTALLATION.md    # Setup & installation guide
│   ├── MANAGEMENT.md      # Comment moderation guide
│   └── DEPLOYMENT.md      # Production deployment guide
├── .env.example           # Root environment template
└── LICENSE                # MIT License
```

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

Open [examples/admin-dashboard/index.html](./examples/admin-dashboard/index.html), enter your Worker URL and `ADMIN_API_KEY`, then manage comments and likes from one page.

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

**GET** `/admin/likes?limit=25`

Returns top liked paths.

**GET** `/admin/worker`

Returns the current Worker URL and configured metadata. Cloudflare account-wide Worker listings should be proxied server-side rather than fetched from browser code.

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

- ✅ CORS validation: Only requests from allowed origins accepted
- ✅ Input validation: Path, text, email checks
- ✅ Comment spam honeypot: Website field silently rejects (bot pattern)
- ✅ Email validation: Basic format checking
- ✅ Content limits: Max lengths prevent abuse
- ✅ Comment moderation: All comments require approval

### Recommendations

- Use HTTPS (Cloudflare default)
- Set specific CORS origins in production
- Monitor pending comments regularly
- Use Cloudflare rate limiting for high-traffic sites
- Archive/delete old rejected comments

## Performance

- Like counts cached in D1 with index optimization
- Comments query uses indexed path + status lookup
- Global Cloudflare distribution for low latency
- Browser localStorage prevents duplicate like requests
- No external dependencies in client scripts

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

Contributions welcome! Areas for enhancement:

- [ ] Admin dashboard for comment moderation
- [ ] Email notifications for pending comments
- [ ] Comment threading/replies
- [ ] Rate limiting in worker
- [ ] Analytics dashboard
- [ ] More client examples (Vue, Svelte, etc.)

## License

MIT - See [LICENSE](./LICENSE) for details

## Support

- 📖 [Installation Guide](./docs/INSTALLATION.md)
- 📝 [Management Guide](./docs/MANAGEMENT.md)  
- 🚀 [Deployment Guide](./docs/DEPLOYMENT.md)
- 🔗 [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- 💾 [D1 Documentation](https://developers.cloudflare.com/d1/)

## Inspiration

This project was inspired by and built from the implementation in [3M1RY33T/3M1RY33T.github.io](https://github.com/3M1RY33T/3M1RY33T.github.io).

---

**Made with ❤️ for static sites everywhere.**

Questions? Start with the [Installation Guide](./docs/INSTALLATION.md) or check [examples/](./examples/).
