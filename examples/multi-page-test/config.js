(function() {
  const params = new URLSearchParams(window.location.search);
  const storageKey = "urthreads:multi-page-test:worker";
  const defaultWorker = "https://cflc-test-worker.3m1ry33t.workers.dev";

  function getStoredWorkerUrl() {
    try {
      return window.localStorage.getItem(storageKey);
    } catch (error) {
      return "";
    }
  }

  function setStoredWorkerUrl(value) {
    try {
      window.localStorage.setItem(storageKey, value);
    } catch (error) {
      // The current page can still use the query-string Worker URL.
    }
  }

  function clearStoredWorkerUrl() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch (error) {
      // Ignore storage errors; the page falls back to the local Worker.
    }
  }

  if (params.get("resetWorker") === "1") {
    clearStoredWorkerUrl();
  }

  const workerParam = params.get("worker");
  if (workerParam) {
    setStoredWorkerUrl(workerParam.replace(/\/$/, ""));
  }

  const workerUrl = workerParam?.replace(/\/$/, "") || getStoredWorkerUrl() || defaultWorker;

  window.THREAD_CF_WORKER = workerUrl;

  window.LIKES_CONFIG = {
    endpoint: `${workerUrl}/likes`,
  };

  window.COMMENTS_CONFIG = {
    endpoint: `${workerUrl}/comments`,
  };

  window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-worker-origin]").forEach((node) => {
      node.textContent = workerUrl;
    });

    document.querySelectorAll("[data-worker-comments][data-page-url]").forEach((section) => {
      try {
        const configuredUrl = new URL(section.dataset.pageUrl || "", window.location.href);
        const currentUrl = new URL(window.location.href);
        section.dataset.pageUrl = new URL(
          `${currentUrl.pathname}${configuredUrl.hash}`,
          currentUrl.origin
        ).href;
      } catch (error) {
        section.dataset.pageUrl = window.location.href;
      }
    });
  });
})();
