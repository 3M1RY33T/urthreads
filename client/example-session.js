/**
 * Utility controls for static urthreads examples.
 */

(function() {
  function shouldRemoveKey(key) {
    return (
      key.startsWith('liked:') ||
      key.startsWith('urthreads:example:worker') ||
      key.startsWith('urthreads:multi-page-test:worker')
    );
  }

  function clearStorage(storage) {
    if (!storage) return 0;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && shouldRemoveKey(key)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
    return keys.length;
  }

  function resetExampleSession() {
    try {
      clearStorage(window.localStorage);
      clearStorage(window.sessionStorage);
    } catch (error) {
      console.warn('[urthreads examples] Browser session storage could not be cleared:', error);
    }
    window.location.reload();
  }

  function initExampleSessionReset() {
    document.querySelectorAll('[data-reset-example-session]').forEach((button) => {
      button.addEventListener('click', resetExampleSession);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExampleSessionReset);
  } else {
    initExampleSessionReset();
  }

  window.UrthreadsExampleSession = {
    reset: resetExampleSession,
    shouldRemoveKey,
  };
})();
