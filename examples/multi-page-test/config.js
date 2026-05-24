(function() {
  const params = new URLSearchParams(window.location.search);
  const storageKey = "urthreads:multi-page-test:worker";
  const localWorker = "http://localhost:8787";

  if (params.get("resetWorker") === "1") {
    window.localStorage.removeItem(storageKey);
  }

  const workerParam = params.get("worker");
  if (workerParam) {
    window.localStorage.setItem(storageKey, workerParam.replace(/\/$/, ""));
  }

  const workerUrl = window.localStorage.getItem(storageKey) || localWorker;

  window.LIKES_CONFIG = {
    endpoint: `${workerUrl}/likes`,
    storagePrefix: "urthreads-multi-page-liked:",
  };

  window.COMMENTS_CONFIG = {
    endpoint: `${workerUrl}/comments`,
  };

  window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-worker-origin]").forEach((node) => {
      node.textContent = workerUrl;
    });
  });
})();
