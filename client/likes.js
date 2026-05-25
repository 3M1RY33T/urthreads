/**
 * Client-side script for Likes feature
 * 
 * Include this in your HTML or import it as a module.
 * Uses localStorage to prevent repeat likes from the same browser.
 * 
 * HTML Requirements:
 * - Add `data-like-button` to like button elements
 * - Add `data-path` attribute with the post path (e.g., "/blog/my-post")
 * - Add `data-like-count` to an element inside the button to show count
 * 
 * Example HTML:
 * <button data-like-button data-path="/blog/my-post">
 *   Like (<span data-like-count>0</span>)
 * </button>
 * 
 * Configuration:
 * Set window.LIKES_CONFIG before including this script:
 * window.LIKES_CONFIG = {
 *   endpoint: 'https://your-worker.workers.dev/likes',
 *   storagePrefix: 'liked:' // localStorage prefix
 * };
 */

(function() {
  // Configuration
  const config = {
    endpoint: window.LIKES_CONFIG?.endpoint || '',
    storagePrefix: window.LIKES_CONFIG?.storagePrefix || 'liked:',
  };

  if (!config.endpoint) {
    console.warn('[Likes] No endpoint configured. Set window.LIKES_CONFIG.endpoint');
    return;
  }

  /**
   * Normalize like count
   */
  function normalizeCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  }

  function getStorageKey(path) {
    return `${config.storagePrefix}${config.endpoint}:${path}`;
  }

  /**
   * Update like button appearance and state
   */
  function setLikeButton(button, count, liked) {
    const countElement = button.querySelector('[data-like-count]');
    if (countElement) {
      countElement.textContent = String(normalizeCount(count));
    }
    button.classList.toggle('is-liked', liked);
    button.setAttribute('aria-pressed', String(liked));
    button.disabled = liked;
  }

  /**
   * Check if user already liked this post (from localStorage)
   */
  function getLiked(path) {
    try {
      return window.localStorage.getItem(getStorageKey(path)) === 'true';
    } catch (error) {
      // Likes still work without localStorage
      return false;
    }
  }

  /**
   * Mark post as liked in localStorage
   */
  function setLiked(path) {
    try {
      window.localStorage.setItem(getStorageKey(path), 'true');
    } catch (error) {
      // Likes still work without localStorage; this only prevents repeat clicks
    }
  }

  /**
   * Make request to likes endpoint
   */
  async function requestLikes(path, options = {}) {
    const url = new URL(config.endpoint);
    url.searchParams.set('path', path);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`Likes request failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Initialize like buttons
   */
  function initLikeButtons() {
    const buttons = Array.from(document.querySelectorAll('[data-like-button]'));

    buttons.forEach(async (button) => {
      const path = button.dataset.path;
      if (!path) return;

      const liked = getLiked(path);
      setLikeButton(button, 0, liked);

      try {
        const payload = await requestLikes(path);
        setLikeButton(button, payload.count, liked);
      } catch (error) {
        console.error('[Likes] Failed to load like count:', error);
        button.disabled = true;
        button.title = 'Likes are unavailable right now.';
      }

      button.addEventListener('click', async () => {
        if (getLiked(path)) return;

        const currentCount = normalizeCount(
          button.querySelector('[data-like-count]')?.textContent
        );
        setLikeButton(button, currentCount + 1, true);

        try {
          const payload = await requestLikes(path, { method: 'POST' });
          setLiked(path);
          setLikeButton(button, payload.count, true);
        } catch (error) {
          console.error('[Likes] Failed to save like:', error);
          setLikeButton(button, currentCount, false);
          button.title = 'Your like could not be saved right now.';
        }
      });
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLikeButtons);
  } else {
    initLikeButtons();
  }

  // Export for module usage
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      initLikeButtons,
      requestLikes,
      normalizeCount,
      getStorageKey,
    };
  }
  window.LikesModule = {
    initLikeButtons,
    requestLikes,
    normalizeCount,
    getStorageKey,
  };
})();
