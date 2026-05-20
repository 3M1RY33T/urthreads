#!/usr/bin/env node

/**
 * Sync approved comments into a README markdown block.
 *
 * The script reads approved comments from the public Worker /comments endpoint
 * and rewrites only the content between:
 *   <!-- comments:start -->
 *   <!-- comments:end -->
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const DEFAULT_START_MARKER = "<!-- comments:start -->";
const DEFAULT_END_MARKER = "<!-- comments:end -->";
const DEFAULT_EMPTY_MESSAGE = "_No approved comments yet._";
const DEFAULT_README_PATH = "README.md";
const DEFAULT_PAGE_ID = "/";
const DEFAULT_LIMIT = 10;

function getConfig(env = process.env) {
  return {
    endpoint: env.COMMENTS_ENDPOINT || env.README_COMMENTS_ENDPOINT || "",
    pageId: env.README_COMMENTS_PAGE_ID || DEFAULT_PAGE_ID,
    readmePath: env.README_COMMENTS_FILE || DEFAULT_README_PATH,
    limit: normalizeLimit(env.README_COMMENTS_LIMIT, DEFAULT_LIMIT),
    sourceUrl: env.README_COMMENTS_SOURCE_URL || "",
    heading: env.README_COMMENTS_HEADING || "## Profile Comments",
    startMarker: env.README_COMMENTS_START_MARKER || DEFAULT_START_MARKER,
    endMarker: env.README_COMMENTS_END_MARKER || DEFAULT_END_MARKER,
    emptyMessage: env.README_COMMENTS_EMPTY_MESSAGE || DEFAULT_EMPTY_MESSAGE,
  };
}

function normalizeLimit(value, fallback) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : fallback;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;

    const request = client.get(
      parsedUrl,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "cflc-readme-comment-sync",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Comments request failed with status ${response.statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error("Comments endpoint returned invalid JSON."));
          }
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(15000, () => {
      request.destroy(new Error("Comments request timed out."));
    });
  });
}

async function fetchApprovedComments(endpoint, pageId, fetchJson = requestJson) {
  if (!endpoint) {
    throw new Error("COMMENTS_ENDPOINT or README_COMMENTS_ENDPOINT is required.");
  }

  const url = new URL(endpoint);
  url.searchParams.set("path", pageId);

  const payload = await fetchJson(url.toString());
  return Array.isArray(payload?.comments) ? payload.comments : [];
}

function flattenComments(comments, depth = 0, output = []) {
  comments.forEach((comment) => {
    output.push({
      id: comment.id,
      authorName: comment.authorName || "Anonymous",
      content: comment.content || "",
      createdAt: comment.createdAt || "",
      depth,
    });

    if (Array.isArray(comment.replies) && comment.replies.length > 0) {
      flattenComments(comment.replies, depth + 1, output);
    }
  });

  return output;
}

function escapeMarkdownText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&(?!(?:[a-zA-Z]+|#[0-9]+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/([`*_{}[\]()#+.!|-])/g, "\\$1");
}

function normalizeCommentText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function formatCommentDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

function renderCommentsMarkdown(comments, options = {}) {
  const limit = normalizeLimit(options.limit, DEFAULT_LIMIT);
  const emptyMessage = options.emptyMessage || DEFAULT_EMPTY_MESSAGE;
  const sourceUrl = options.sourceUrl || "";
  const flatComments = flattenComments(comments).slice(0, limit);
  const lines = [];

  if (flatComments.length === 0) {
    lines.push(emptyMessage);
  } else {
    flatComments.forEach((comment) => {
      const prefix = comment.depth > 0 ? "  ".repeat(comment.depth) : "";
      const author = escapeMarkdownText(comment.authorName);
      const body = escapeMarkdownText(normalizeCommentText(comment.content));
      const date = formatCommentDate(comment.createdAt);
      const meta = date ? `${author} · ${date}` : author;

      lines.push(`${prefix}- **${meta}**: ${body}`);
    });
  }

  if (sourceUrl) {
    lines.push("");
    lines.push(`[Leave a comment](${sourceUrl})`);
  }

  return lines.join("\n");
}

function replaceCommentsBlock(readmeContent, renderedComments, options = {}) {
  const startMarker = options.startMarker || DEFAULT_START_MARKER;
  const endMarker = options.endMarker || DEFAULT_END_MARKER;
  const heading = options.heading || "## Profile Comments";
  const block = `${startMarker}\n${renderedComments}\n${endMarker}`;
  const startIndex = readmeContent.indexOf(startMarker);
  const endIndex = readmeContent.indexOf(endMarker);

  if ((startIndex === -1) !== (endIndex === -1)) {
    throw new Error("README comments block is missing either the start or end marker.");
  }

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = readmeContent.slice(0, startIndex);
    const after = readmeContent.slice(endIndex + endMarker.length);
    return `${before}${block}${after}`;
  }

  if (startIndex !== -1 && endIndex <= startIndex) {
    throw new Error("README comments block end marker must appear after the start marker.");
  }

  const separator = readmeContent.endsWith("\n") ? "\n" : "\n\n";
  return `${readmeContent}${separator}${heading}\n\n${block}\n`;
}

async function syncReadmeComments(config = getConfig(), fetchJson = requestJson) {
  const readmePath = path.resolve(config.readmePath);
  const readmeContent = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, "utf8")
    : "";
  const comments = await fetchApprovedComments(config.endpoint, config.pageId, fetchJson);
  const renderedComments = renderCommentsMarkdown(comments, config);
  const nextContent = replaceCommentsBlock(readmeContent, renderedComments, config);

  if (nextContent !== readmeContent) {
    fs.writeFileSync(readmePath, nextContent);
    return { changed: true, readmePath, count: flattenComments(comments).length };
  }

  return { changed: false, readmePath, count: flattenComments(comments).length };
}

async function main() {
  const result = await syncReadmeComments();
  const status = result.changed ? "Updated" : "No changes for";
  process.stdout.write(
    `${status} ${path.relative(process.cwd(), result.readmePath)} with ${result.count} approved comment(s).\n`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_END_MARKER,
  DEFAULT_START_MARKER,
  escapeMarkdownText,
  fetchApprovedComments,
  flattenComments,
  formatCommentDate,
  getConfig,
  normalizeCommentText,
  replaceCommentsBlock,
  renderCommentsMarkdown,
  syncReadmeComments,
};
