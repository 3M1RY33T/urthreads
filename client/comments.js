/**
 * Client-side script for Comments feature
 * 
 * Handles loading, displaying, and submitting comments with moderation.
 * Comments are moderated before appearing publicly.
 * 
 * HTML Requirements (refer to examples for detailed structure):
 * - Container with `data-worker-comments` attribute
 * - Set data-page-id, data-page-url, data-page-title
 * - Comment list element with `data-comment-list`
 * - Comment form with `data-comment-draft-form`
 * - Identity form with `data-comment-identity-form`
 * - Modal dialog with `data-comment-modal`
 * - Status message element with `data-comment-status`
 * 
 * Configuration:
 * Set window.COMMENTS_CONFIG before including this script:
 * window.COMMENTS_CONFIG = {
 *   endpoint: 'https://your-worker.workers.dev/comments'
 * };
 */

(function() {
  // Configuration
  const config = {
    endpoint: window.COMMENTS_CONFIG?.endpoint || '',
  };

  if (!config.endpoint) {
    console.warn('[Comments] No endpoint configured. Set window.COMMENTS_CONFIG.endpoint');
    return;
  }

  /**
   * Format date for display
   */
  function formatCommentDate(value) {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  /**
   * Create a comment element with reply and like actions
   */
  function makeComment(comment, onReply, onLike, depth = 0) {
    const item = document.createElement('article');
    item.className = 'comment-item';
    if (depth > 0) {
      item.classList.add('comment-reply');
      item.style.marginLeft = '1.5rem';
    }

    const meta = document.createElement('p');
    meta.className = 'comment-meta';
    const author = comment.authorName || 'Anonymous';
    const createdAt = formatCommentDate(comment.createdAt);
    meta.textContent = createdAt ? `${author} · ${createdAt}` : author;

    const content = document.createElement('p');
    content.className = 'comment-body';
    content.textContent = comment.content || '';

    const actions = document.createElement('div');
    actions.className = 'comment-actions';

    const likeButton = document.createElement('button');
    likeButton.type = 'button';
    likeButton.className = 'comment-like-button';
    likeButton.textContent = `Like (${comment.likesCount || 0})`;
    likeButton.addEventListener('click', () => {
      if (onLike) onLike(comment, likeButton);
    });

    const replyButton = document.createElement('button');
    replyButton.type = 'button';
    replyButton.className = 'comment-reply-button';
    replyButton.textContent = 'Reply';
    replyButton.addEventListener('click', () => {
      if (onReply) onReply(comment);
    });

    actions.append(likeButton, replyButton);
    item.append(meta, content, actions);

    if (comment.replies && comment.replies.length > 0) {
      const replies = document.createElement('div');
      replies.className = 'comment-replies';
      comment.replies.forEach((reply) => {
        replies.append(makeComment(reply, onReply, onLike, depth + 1));
      });
      item.append(replies);
    }

    return item;
  }

  /**
   * Resize textarea to fit content
   */
  function resizeCommentField(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  /**
   * Fetch approved comments from endpoint
   */
  async function loadComments(endpoint, pageId, listElement, statusElement, onReply, onLike) {
    listElement.textContent = 'Loading comments...';

    try {
      const url = new URL(endpoint);
      url.searchParams.set('path', pageId);

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load comments: ${response.statusText}`);
      }

      const payload = await response.json();
      const comments = payload?.comments || [];

      listElement.replaceChildren();

      if (comments.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'comment-empty';
        empty.textContent = 'There are no comments for this post yet.';
        listElement.append(empty);
        return;
      }

      comments.forEach((comment) => {
        listElement.append(makeComment(comment, onReply, onLike));
      });
    } catch (error) {
      console.error('[Comments] Failed to load comments:', error);
      listElement.textContent = '';
      if (statusElement) {
        statusElement.textContent = 'Comments could not load right now.';
        statusElement.classList.add('is-error');
      }
    }
  }

  /**
   * Submit a comment
   */
  async function submitComment(
    endpoint,
    pageId,
    pageUrl,
    pageTitle,
    nickname,
    email,
    website,
    content,
    parentId,
    statusElement,
    submitButton
  ) {
    if (statusElement) {
      statusElement.textContent = 'Posting your comment...';
      statusElement.classList.remove('is-error');
    }
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: pageId,
          pageUrl,
          pageTitle,
          content,
          nickname,
          email,
          website,
          parentId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to post comment: ${response.statusText}`);
      }

      if (statusElement) {
        statusElement.textContent = 'Thanks. Your comment is awaiting approval.';
      }
      return true;
    } catch (error) {
      console.error('[Comments] Failed to submit comment:', error);
      if (statusElement) {
        statusElement.textContent = 'Your comment could not be posted right now.';
        statusElement.classList.add('is-error');
      }
      return false;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function likeComment(comment, button, statusElement) {
    if (!comment || !comment.id) return;

    if (button) {
      button.disabled = true;
    }

    try {
      const url = new URL(config.endpoint);
      url.pathname = url.pathname.replace(/\/$/, '') + '/like';
      url.searchParams.set('commentId', comment.id);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to like comment: ${response.statusText}`);
      }

      const payload = await response.json();
      if (payload?.likes != null) {
        comment.likesCount = Number(payload.likes);
        if (button) {
          button.textContent = `Like (${comment.likesCount})`;
        }
      }
    } catch (error) {
      console.error('[Comments] Failed to like comment:', error);
      if (statusElement) {
        statusElement.textContent = 'Unable to like the comment right now.';
        statusElement.classList.add('is-error');
      }
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  /**
   * Initialize comment section
   */
  function initCommentSection(section) {
    const draftForm = section.querySelector('[data-comment-draft-form]');
    const identityForm = section.querySelector('[data-comment-identity-form]');
    const modal = section.querySelector('[data-comment-modal]');
    const cancelButton = section.querySelector('[data-comment-cancel]');
    const status = section.querySelector('[data-comment-status]');
    const list = section.querySelector('[data-comment-list]');
    const contentField = draftForm?.elements.content;
    const nicknameField = identityForm?.elements.nickname;
    const sendButton = draftForm?.querySelector('[data-comment-send]');

    if (!draftForm || !identityForm || !modal || !list) {
      console.warn('[Comments] Missing required elements in comment section');
      return;
    }

    const pageId = section.dataset.pageId;
    const pageUrl = section.dataset.pageUrl;
    const pageTitle = section.dataset.pageTitle;
    let pendingContent = '';
    let replyTargetId = null;

    const setReplyTarget = (comment) => {
      replyTargetId = comment.id;
      setStatus(`Replying to ${comment.authorName}. Your reply will require approval.`);
      contentField?.focus();
    };

    const clearReplyTarget = () => {
      replyTargetId = null;
      if (status) {
        status.textContent = '';
        status.classList.remove('is-error');
      }
    };

    const handleLike = (comment, button) => {
      likeComment(comment, button, status);
    };

    if (!pageId || !pageUrl || !pageTitle) {
      console.warn('[Comments] Missing required data attributes (pageId, pageUrl, pageTitle)');
      return;
    }

    // Modal controls
    const openModal = () => {
      modal.hidden = false;
      document.body.classList.add('comment-modal-open');
      window.setTimeout(() => nicknameField?.focus(), 0);
    };

    const closeModal = () => {
      modal.hidden = true;
      document.body.classList.remove('comment-modal-open');
    };

    // Draft form handlers
    const updateSendButton = () => {
      if (sendButton && contentField) {
        sendButton.disabled = contentField.value.trim() === '';
      }
    };

    const setStatus = (message, isError = false) => {
      if (status) {
        status.textContent = message;
        status.classList.toggle('is-error', isError);
      }
    };

    contentField?.addEventListener('input', () => {
      resizeCommentField(contentField);
      updateSendButton();
    });

    draftForm.addEventListener('submit', (event) => {
      event.preventDefault();
      pendingContent = contentField?.value.trim() || '';
      if (!pendingContent) return;
      setStatus('');
      openModal();
    });

    // Identity form (nickname/email) handlers
    identityForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const formData = new FormData(identityForm);
      const submitButton = identityForm.querySelector('button[type="submit"]');
      const nickname = String(formData.get('nickname') || '').trim();
      const email = String(formData.get('email') || '').trim();
      const website = String(formData.get('website') || '').trim();

      if (!nickname || !pendingContent) return;

      const success = await submitComment(
        config.endpoint,
        pageId,
        pageUrl,
        pageTitle,
        nickname,
        email,
        website,
        pendingContent,
        replyTargetId,
        status,
        submitButton
      );

      if (success) {
        pendingContent = '';
        replyTargetId = null;
        draftForm.reset();
        resizeCommentField(contentField);
        updateSendButton();
        identityForm.reset();
        clearReplyTarget();
        closeModal();
        await loadComments(config.endpoint, pageId, list, status, setReplyTarget, handleLike);
      }
    });

    // Modal close handlers
    cancelButton?.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    // Initial setup
    loadComments(config.endpoint, pageId, list, status, setReplyTarget, handleLike);
    resizeCommentField(contentField);
    updateSendButton();
  }

  /**
   * Initialize all comment sections on page
   */
  function initComments() {
    document.querySelectorAll('[data-worker-comments]').forEach(initCommentSection);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initComments);
  } else {
    initComments();
  }

  // Export for module usage
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      initComments,
      formatCommentDate,
      makeComment,
    };
  }
  window.CommentsModule = {
    initComments,
    formatCommentDate,
    makeComment,
  };
})();
