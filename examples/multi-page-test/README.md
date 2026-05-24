# Multi-Page Test Site

This example is a small static site for exercising `urthreads` across several pages.

## Run It

Start the Worker locally:

```bash
wrangler dev
```

Serve the repository root from another terminal:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/examples/multi-page-test/index.html
```

By default the example uses:

- likes endpoint: `http://localhost:8787/likes`
- comments endpoint: `http://localhost:8787/comments`

To test against a deployed Worker, add `?worker=` to any page:

```text
http://localhost:8000/examples/multi-page-test/index.html?worker=https://your-worker.workers.dev
```

The value is saved to `localStorage` for the rest of the pages. Use `?resetWorker=1` to return to local endpoints.

## What This Covers

- Multiple pages with distinct `data-path` and `data-page-id` values.
- Page likes loaded across several paths from one index page.
- A full article with likes and comments.
- A second article for path isolation checks.
- A comment-only page with two independent comment sections.
- Reply, comment-like, pending moderation, approved comment loading, and unavailable Worker states.

## Suggested Manual Pass

1. Open the hub and confirm all like counts load independently.
2. Like the hub and one article, then reload and confirm the liked buttons stay disabled in that browser.
3. Post a comment on Article Alpha and verify it appears as pending in the dashboard.
4. Approve the comment, reload Article Alpha, then reply to it.
5. Open Article Beta and confirm Article Alpha comments do not appear there.
6. Use the comment-only page and submit to both sections to confirm separate page IDs.
