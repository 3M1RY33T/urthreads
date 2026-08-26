(function() {
  const storageKeys = {
    workerUrl: 'urthreads:admin:workerUrl',
    theme: 'urthreads:admin:theme',
  };

  const state = {
    workerUrl: window.sessionStorage.getItem(storageKeys.workerUrl) || '',
    isAuthenticated: false,
    theme: window.localStorage.getItem(storageKeys.theme) || 'light',
    statsRange: '30d',
    statsStartDate: '',
    statsStartDatePinned: false,
    statsCalendarMonth: null,
    statsRequestId: 0,
    auditDate: '',
    auditCalendarMonth: null,
    deniedKeywords: [],
    pendingKeywordDelete: '',
    pendingKeywordDeleteTimer: null,
    pendingConfirmResolve: null,
  };

  const elements = {
    authOverlay: document.querySelector('[data-auth-overlay]'),
    authForm: document.querySelector('[data-auth-form]'),
    authStatus: document.querySelector('[data-auth-status]'),
    authClose: document.querySelector('[data-auth-close]'),
    endSession: document.querySelector('[data-end-session]'),
    confirmOverlay: document.querySelector('[data-confirm-overlay]'),
    confirmForm: document.querySelector('[data-confirm-form]'),
    confirmMessage: document.querySelector('[data-confirm-message]'),
    confirmCancel: document.querySelector('[data-confirm-cancel]'),
    confirmClose: document.querySelector('[data-confirm-close]'),
    confirmSubmit: document.querySelector('[data-confirm-submit]'),
    workerUrl: document.querySelector('[name="workerUrl"]'),
    adminKey: document.querySelector('[name="adminKey"]'),
    sessionMenu: document.querySelector('[data-session-menu]'),
    sessionPopover: document.querySelector('[data-session-popover]'),
    sessionLogout: document.querySelector('[data-session-logout]'),
    sessionCard: document.querySelector('[data-session-card]'),
    sessionWorker: document.querySelector('[data-session-worker]'),
    sessionActions: document.querySelectorAll('[data-session-action]'),
    status: document.querySelector('[data-status]'),
    themeToggle: document.querySelector('[data-theme-toggle]'),
    logoRefresh: document.querySelector('[data-logo-refresh]'),
    refresh: document.querySelector('[data-refresh]'),
    pageLikes: document.querySelector('[data-page-likes]'),
    commentLikes: document.querySelector('[data-comment-likes]'),
    pendingComments: document.querySelector('[data-pending-comments]'),
    approvedComments: document.querySelector('[data-approved-comments]'),
    statsChart: document.querySelector('[data-stats-chart]'),
    statsLegend: document.querySelector('[data-stats-legend]'),
    statsRangeButtons: document.querySelectorAll('[data-stats-range]'),
    statsDatePicker: document.querySelector('[data-stats-date-picker]'),
    statsDateToggle: document.querySelector('[data-stats-date-toggle]'),
    statsDateLabel: document.querySelector('[data-stats-date-label]'),
    statsDatePopover: document.querySelector('[data-stats-date-popover]'),
    statsDateMonth: document.querySelector('[data-stats-date-month]'),
    statsDateGrid: document.querySelector('[data-stats-date-grid]'),
    statsDatePrev: document.querySelector('[data-stats-date-prev]'),
    statsDateNext: document.querySelector('[data-stats-date-next]'),
    commentStatus: document.querySelector('[data-comment-status]'),
    commentPath: document.querySelector('[data-comment-path]'),
    commentLimit: document.querySelector('[data-comment-limit]'),
    keywordPopoverToggle: document.querySelector('[data-keyword-popover-toggle]'),
    keywordPopover: document.querySelector('[data-keyword-popover]'),
    keywordPopoverForm: document.querySelector('[data-keyword-popover-form]'),
    keywordPopoverInput: document.querySelector('[data-keyword-popover-input]'),
    keywordPopoverList: document.querySelector('[data-keyword-popover-list]'),
    likesSort: document.querySelector('[data-likes-sort]'),
    likesDirection: document.querySelector('[data-likes-direction]'),
    likesPath: document.querySelector('[data-likes-path]'),
    likesLimit: document.querySelector('[data-likes-limit]'),
    auditMethod: document.querySelector('[data-audit-method]'),
    auditPath: document.querySelector('[data-audit-path]'),
    auditLimit: document.querySelector('[data-audit-limit]'),
    auditDatePicker: document.querySelector('[data-audit-date-picker]'),
    auditDateToggle: document.querySelector('[data-audit-date-toggle]'),
    auditDateLabel: document.querySelector('[data-audit-date-label]'),
    auditDatePopover: document.querySelector('[data-audit-date-popover]'),
    auditDateMonth: document.querySelector('[data-audit-date-month]'),
    auditDateGrid: document.querySelector('[data-audit-date-grid]'),
    auditDatePrev: document.querySelector('[data-audit-date-prev]'),
    auditDateNext: document.querySelector('[data-audit-date-next]'),
    commentList: document.querySelector('[data-comment-list]'),
    likesList: document.querySelector('[data-likes-list]'),
    workerList: document.querySelector('[data-worker-list]'),
    auditList: document.querySelector('[data-audit-list]'),
    collapseToggles: document.querySelectorAll('[data-collapse-toggle]'),
  };

  function setStatus(message, isError) {
    elements.status.textContent = message || '';
    elements.status.classList.toggle('is-error', Boolean(isError));
  }

  function setAuthStatus(message, isError) {
    elements.authStatus.textContent = message || '';
    elements.authStatus.classList.toggle('is-error', Boolean(isError));
  }

  function applyTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    state.theme = nextTheme;
    document.body.dataset.theme = nextTheme;
    const label = nextTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    elements.themeToggle.setAttribute('aria-label', label);
    elements.themeToggle.title = label;
    window.localStorage.setItem(storageKeys.theme, nextTheme);
  }

  function setSessionWorker(connectionState) {
    const hasSession = Boolean(state.workerUrl && state.isAuthenticated);
    const nextState = connectionState || (hasSession ? 'connected' : 'disconnected');
    const labels = {
      connected: 'Connected',
      disconnected: 'Not connected',
      error: 'Connection issue',
      loading: 'Connecting...',
    };

    elements.sessionWorker.textContent = labels[nextState] || labels.disconnected;
    elements.sessionCard.dataset.connection = nextState;
  }

  function normalizeWorkerUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function endpoint(path) {
    return `${state.workerUrl}${path}`;
  }

  // True for a plain-HTTP loopback worker origin (localhost/127.0.0.1/[::1]).
  // Mirrors src/worker-security.mjs isLocalHttpOrigin: brackets stripped so the
  // browser never gets told to "deploy again" for a local worker.
  function isLocalHttpWorkerUrl(workerUrl) {
    if (!workerUrl) return false;
    try {
      const url = new URL(workerUrl);
      if (url.protocol !== 'http:') return false;
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch (error) {
      return false;
    }
  }

  function canAttemptCookieSession(workerUrl = state.workerUrl) {
    if (!workerUrl || !window.location.origin || window.location.origin === 'null') {
      return false;
    }

    try {
      const url = new URL(workerUrl);
      if (url.protocol === 'https:') {
        return true;
      }
      if (url.protocol === 'http:') {
        return isLocalHttpWorkerUrl(workerUrl);
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async function verifyCookieSession(workerUrl = state.workerUrl) {
    if (!canAttemptCookieSession(workerUrl)) return false;

    const response = await fetch(`${workerUrl}/admin/session`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    }).catch(() => null);
    if (!response || !response.ok) return false;

    const payload = await response.json().catch(() => ({}));
    return Boolean(payload.authenticated);
  }

  function clearAdminSession(options = {}) {
    const shouldClearWorkerUrl = options.clearWorkerUrl !== false;
    state.isAuthenticated = false;

    if (shouldClearWorkerUrl) {
      state.workerUrl = '';
      window.sessionStorage.removeItem(storageKeys.workerUrl);
    }
    setSessionWorker();
  }

  async function endSession() {
    setSessionPopoverOpen(false);
    if (state.workerUrl) {
      await fetch(endpoint('/admin/session'), {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      }).catch(() => {});
    }
    clearAdminSession();
    window.location.reload();
  }

  function setSessionPopoverOpen(open) {
    const shouldOpen = Boolean(open && state.isAuthenticated);
    elements.sessionPopover.hidden = !shouldOpen;
    elements.sessionCard.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  }

  function showAuthPrompt(message) {
    setSessionPopoverOpen(false);
    elements.workerUrl.value = state.workerUrl;
    elements.adminKey.value = '';
    elements.authOverlay.hidden = false;
    document.body.classList.add('auth-open');
    setAuthStatus(message || '', Boolean(message));

    window.setTimeout(() => {
      if (state.workerUrl) {
        elements.adminKey.focus();
      } else {
        elements.workerUrl.focus();
      }
    }, 0);
  }

  function hideAuthPrompt() {
    elements.authOverlay.hidden = true;
    document.body.classList.remove('auth-open');
    setAuthStatus('');
  }

  function closeAuthPrompt() {
    if (!state.workerUrl || !state.isAuthenticated) {
      setAuthStatus('Worker URL and admin key are required.', true);
      return;
    }

    hideAuthPrompt();
  }

  function closeConfirmPrompt(result) {
    elements.confirmOverlay.hidden = true;
    document.body.classList.remove('modal-open');

    if (state.pendingConfirmResolve) {
      state.pendingConfirmResolve(result);
      state.pendingConfirmResolve = null;
    }
  }

  function confirmCommentAction(actionLabel, customMessage = '') {
    const submitLabel = actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1);
    elements.confirmMessage.textContent =
      customMessage || `Are you sure you want to ${actionLabel} this comment?`;
    elements.confirmSubmit.setAttribute('aria-label', submitLabel);
    elements.confirmSubmit.title = submitLabel;
    elements.confirmOverlay.hidden = false;
    document.body.classList.add('modal-open');

    window.setTimeout(() => {
      elements.confirmCancel.focus();
    }, 0);

    return new Promise((resolve) => {
      state.pendingConfirmResolve = resolve;
    });
  }

  function handleExpiredSession() {
    clearAdminSession({ clearWorkerUrl: false });
    showAuthPrompt('Session expired. Enter the admin key again.');
    setStatus('Session expired.', true);
  }

  function setPanelCollapsed(button, collapsed) {
    const body = document.getElementById(button.getAttribute('aria-controls'));
    const panel = button.closest('[data-panel]');
    const panelName = button.getAttribute('aria-label')
      .replace(/^Collapse\s+|^Expand\s+/i, '');

    if (!body || !panel) return;

    body.hidden = collapsed;
    panel.querySelectorAll('[data-collapsible-extra]').forEach((element) => {
      element.hidden = collapsed;
    });
    panel.dataset.collapsed = collapsed ? 'true' : 'false';
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const label = `${collapsed ? 'Expand' : 'Collapse'} ${panelName}`;
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function togglePanel(button) {
    setPanelCollapsed(button, button.getAttribute('aria-expanded') === 'true');
  }

  function parseStatsRangeDays() {
    const match = String(state.statsRange || '30d').match(/^(\d+)d$/);
    return match ? Number(match[1]) : 30;
  }

  function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateInputValue(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (toDateInputValue(date) !== value) return null;
    return date;
  }

  function formatStatsDateLabel(value) {
    const date = parseDateInputValue(value);
    if (!date) return 'Pick date';
    return new Intl.DateTimeFormat([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function getLatestStatsStartDate() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (parseStatsRangeDays() - 1));
    return toDateInputValue(date);
  }

  function getRollingStatsStartDate() {
    return getLatestStatsStartDate();
  }

  function clampStatsStartDate() {
    const latest = getLatestStatsStartDate();
    if (!state.statsStartDate || state.statsStartDate > latest) {
      state.statsStartDate = latest;
      state.statsCalendarMonth = parseDateInputValue(latest);
      updateStatsDatePicker();
    }
  }

  function setDefaultStatsStartDate(force = false) {
    if (!force && state.statsStartDatePinned) return;
    state.statsStartDate = getRollingStatsStartDate();
    state.statsCalendarMonth = parseDateInputValue(state.statsStartDate);
    updateStatsDatePicker();
  }

  function setStatsDatePopoverOpen(open) {
    elements.statsDatePopover.hidden = !open;
    elements.statsDateToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      state.statsCalendarMonth = parseDateInputValue(state.statsStartDate) || new Date();
      renderStatsDateCalendar();
    }
  }

  function shiftStatsCalendarMonth(offset) {
    const base = state.statsCalendarMonth || new Date();
    state.statsCalendarMonth = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    renderStatsDateCalendar();
  }

  async function selectStatsStartDate(value) {
    state.statsStartDate = value;
    state.statsStartDatePinned = true;
    state.statsCalendarMonth = parseDateInputValue(value);
    updateStatsDatePicker();
    setStatsDatePopoverOpen(false);
    await safeLoadStats();
  }

  function updateStatsDatePicker() {
    elements.statsDateLabel.textContent = formatStatsDateLabel(state.statsStartDate);
    elements.statsDateToggle.title = `Start date: ${elements.statsDateLabel.textContent}`;
    renderStatsDateCalendar();
  }

  function renderStatsDateCalendar() {
    if (!elements.statsDateGrid || elements.statsDatePopover.hidden) return;

    const selected = parseDateInputValue(state.statsStartDate);
    const todayValue = toDateInputValue(new Date());
    const latestValue = getLatestStatsStartDate();
    const month = state.statsCalendarMonth || selected || new Date();
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const nextMonthStart = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());

    elements.statsDateMonth.textContent = new Intl.DateTimeFormat([], {
      month: 'long',
      year: 'numeric',
    }).format(monthStart);
    elements.statsDateNext.disabled = toDateInputValue(nextMonthStart) > latestValue;

    elements.statsDateGrid.replaceChildren();
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const value = toDateInputValue(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stats-date-day';
      button.textContent = String(date.getDate());
      button.dataset.date = value;
      button.classList.toggle('is-muted', date.getMonth() !== monthStart.getMonth());
      button.classList.toggle('is-today', value === todayValue);
      button.classList.toggle('is-selected', selected && value === state.statsStartDate);
      button.disabled = value > latestValue;
      button.setAttribute('aria-label', new Intl.DateTimeFormat([], {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date));
      button.addEventListener('click', () => {
        selectStatsStartDate(value);
      });
      elements.statsDateGrid.append(button);
    }
  }

  function setDefaultAuditDate(force = false) {
    if (!force && state.auditDate) return;
    state.auditDate = toDateInputValue(new Date());
    state.auditCalendarMonth = parseDateInputValue(state.auditDate);
    updateAuditDatePicker();
  }

  function setAuditDatePopoverOpen(open) {
    elements.auditDatePopover.hidden = !open;
    elements.auditDateToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      state.auditCalendarMonth = parseDateInputValue(state.auditDate) || new Date();
      renderAuditDateCalendar();
    }
  }

  function shiftAuditCalendarMonth(offset) {
    const base = state.auditCalendarMonth || new Date();
    state.auditCalendarMonth = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    renderAuditDateCalendar();
  }

  async function selectAuditDate(value) {
    state.auditDate = value;
    state.auditCalendarMonth = parseDateInputValue(value);
    updateAuditDatePicker();
    setAuditDatePopoverOpen(false);
    await safeLoadAuditLogs();
  }

  function updateAuditDatePicker() {
    elements.auditDateLabel.textContent = formatStatsDateLabel(state.auditDate);
    elements.auditDateToggle.title = `Log date: ${elements.auditDateLabel.textContent}`;
    renderAuditDateCalendar();
  }

  function renderAuditDateCalendar() {
    if (!elements.auditDateGrid || elements.auditDatePopover.hidden) return;

    const selected = parseDateInputValue(state.auditDate);
    const today = new Date();
    const todayValue = toDateInputValue(today);
    const month = state.auditCalendarMonth || selected || today;
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const nextMonthStart = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());

    elements.auditDateMonth.textContent = new Intl.DateTimeFormat([], {
      month: 'long',
      year: 'numeric',
    }).format(monthStart);
    elements.auditDateNext.disabled = toDateInputValue(nextMonthStart) > todayValue;

    elements.auditDateGrid.replaceChildren();
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const value = toDateInputValue(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stats-date-day';
      button.textContent = String(date.getDate());
      button.dataset.date = value;
      button.classList.toggle('is-muted', date.getMonth() !== monthStart.getMonth());
      button.classList.toggle('is-today', value === todayValue);
      button.classList.toggle('is-selected', selected && value === state.auditDate);
      button.disabled = value > todayValue;
      button.setAttribute('aria-label', new Intl.DateTimeFormat([], {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date));
      button.addEventListener('click', () => {
        selectAuditDate(value);
      });
      elements.auditDateGrid.append(button);
    }
  }

  async function requestAdmin(path, options) {
    if (!state.workerUrl) {
      showAuthPrompt();
      throw new Error('Worker URL is required.');
    }

    const response = await fetch(endpoint(path), {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options && options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options && options.headers ? options.headers : {}),
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        handleExpiredSession();
      }
      throw new Error(payload.error || `Request failed with ${response.status}.`);
    }
    state.isAuthenticated = true;
    return payload;
  }

  async function createAdminSession(workerUrl, adminKey, credentialsMode = 'include') {
    const response = await fetch(`${workerUrl}/admin/session`, {
      method: 'POST',
      credentials: credentialsMode,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        adminKey,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && payload.reason === 'missing_admin_key') {
        throw new Error('The deployed Worker does not have ADMIN_API_KEY set. Run wrangler secret put ADMIN_API_KEY, paste your admin key, then try again.');
      }
      if (response.status === 401 && payload.reason === 'admin_key_expired') {
        if (isLocalHttpWorkerUrl(state.workerUrl)) {
          throw new Error('The local Worker says this admin key is expired. Run `npm run setup:dev` to reset .dev.vars, then restart `npm run dev`.');
        }
        throw new Error('The deployed Worker says this admin key is expired. Generate a new key or update ADMIN_API_KEY_EXPIRES_AT, then deploy again.');
      }
      if (response.status === 401 && payload.reason === 'invalid_admin_key') {
        throw new Error('The admin key was rejected by the deployed Worker. Make sure you ran wrangler secret put ADMIN_API_KEY with the same key from your .env.');
      }
      throw new Error(payload.error || `Session request failed with ${response.status}.`);
    }
    return payload;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function setEmpty(list, message) {
    list.replaceChildren();
    const item = document.createElement('li');
    item.className = 'empty-state';
    item.textContent = message;
    list.append(item);
  }

  function clearPendingKeywordDelete(render = true) {
    if (state.pendingKeywordDeleteTimer) {
      window.clearTimeout(state.pendingKeywordDeleteTimer);
      state.pendingKeywordDeleteTimer = null;
    }
    if (!state.pendingKeywordDelete) return;
    state.pendingKeywordDelete = '';
    if (render) {
      renderDeniedKeywordsPopover();
    }
  }

  function setPendingKeywordDelete(keyword) {
    clearPendingKeywordDelete(false);
    state.pendingKeywordDelete = keyword;
    state.pendingKeywordDeleteTimer = window.setTimeout(() => {
      clearPendingKeywordDelete();
    }, 5000);
    renderDeniedKeywordsPopover();
  }

  function setKeywordPopoverOpen(open) {
    if (!open) {
      clearPendingKeywordDelete();
    }
    elements.keywordPopover.hidden = !open;
    elements.keywordPopoverToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function createTrashIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.25');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    [
      'M3 6h18',
      'M8 6V4h8v2',
      'M6 6l1 16h10l1-16',
      'M10 11v6',
      'M14 11v6',
    ].forEach((pathData) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      svg.append(path);
    });

    return svg;
  }

  function renderDeniedKeywordsPopover() {
    elements.keywordPopoverList.replaceChildren();
    if (!state.deniedKeywords.length) {
      const item = document.createElement('li');
      item.className = 'keyword-popover-empty';
      item.textContent = 'No denied keywords';
      elements.keywordPopoverList.append(item);
      return;
    }

    state.deniedKeywords.forEach((keyword) => {
      const item = document.createElement('li');
      item.className = 'keyword-popover-item';
      const button = document.createElement('button');
      const isPendingDelete = state.pendingKeywordDelete === keyword;
      button.type = 'button';
      button.className = 'keyword-popover-badge';
      button.classList.toggle('is-delete-pending', isPendingDelete);
      button.dataset.deniedKeyword = keyword;
      button.setAttribute('aria-label', 'Delete Keyword');
      button.title = 'Delete Keyword';
      if (isPendingDelete) {
        button.append(createTrashIcon());
      } else {
        button.textContent = keyword;
      }
      item.append(button);
      elements.keywordPopoverList.append(item);
    });
  }

  function renderSummary(summary) {
    elements.pageLikes.textContent = String(summary.likes?.totalLikes || 0);
    elements.commentLikes.textContent = String(summary.likes?.totalCommentLikes || 0);
    elements.pendingComments.textContent = String(summary.comments?.pending || 0);
    elements.approvedComments.textContent = String(summary.comments?.approved || 0);
  }

  function renderStatsChart(stats) {
    const points = stats.points || [];
    const bucketUnit = stats.bucketUnit || 'day';
    const series = [
      { key: 'pageLikes', label: 'Page likes', color: 'var(--like-icon)' },
      { key: 'commentLikes', label: 'Comment likes', color: 'var(--chart-comment-like)' },
      { key: 'comments', label: 'Comments', color: 'var(--accent)' },
      { key: 'moderationActions', label: 'Moderation', color: 'var(--pending-text)' },
    ];

    elements.statsLegend.replaceChildren();
    series.forEach((item) => {
      const legendItem = document.createElement('span');
      legendItem.className = 'stats-chart-legend-item';
      const swatch = document.createElement('span');
      swatch.style.background = item.color;
      legendItem.append(swatch, document.createTextNode(item.label));
      elements.statsLegend.append(legendItem);
    });

    elements.statsChart.replaceChildren();
    if (!points.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No trend data loaded.';
      elements.statsChart.append(empty);
      return;
    }

    const width = 720;
    const height = 220;
    const padding = { top: 18, right: 18, bottom: 34, left: 36 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(
      1,
      ...points.flatMap((point) => series.map((item) => Number(point[item.key] || 0)))
    );
    const xForIndex = (index) => padding.left + (
      points.length === 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth
    );
    const yForValue = (value) => padding.top + chartHeight - ((Number(value || 0) / maxValue) * chartHeight);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'stats-chart');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      bucketUnit === 'hour'
        ? 'Engagement trend for the current day'
        : `Engagement trend for the last ${stats.rangeDays || points.length} days`
    );

    [0, 0.5, 1].forEach((ratio) => {
      const y = padding.top + chartHeight - (chartHeight * ratio);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', 'stats-chart-grid-line');
      line.setAttribute('x1', String(padding.left));
      line.setAttribute('x2', String(width - padding.right));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      svg.append(line);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('class', 'stats-chart-axis-label');
      label.setAttribute('x', String(padding.left - 10));
      label.setAttribute('y', String(y + 4));
      label.setAttribute('text-anchor', 'end');
      label.textContent = String(Math.round(maxValue * ratio));
      svg.append(label);
    });

    const labelIndexes = [0, Math.floor((points.length - 1) / 2), points.length - 1]
      .filter((value, index, values) => values.indexOf(value) === index);
    const formatPointLabel = (point, options = {}) => {
      const bucketValue = point.bucket || point.day;
      const date = new Date(bucketUnit === 'hour' ? bucketValue : `${point.day}T00:00:00Z`);
      if (bucketUnit === 'hour') {
        return new Intl.DateTimeFormat([], {
          hour: 'numeric',
          ...(options.includeDate ? { month: 'short', day: 'numeric' } : {}),
          ...(options.includeYear ? { year: 'numeric' } : {}),
        }).format(date);
      }
      return new Intl.DateTimeFormat([], {
        month: 'short',
        day: 'numeric',
        ...(options.includeYear ? { year: 'numeric' } : {}),
      }).format(date);
    };
    labelIndexes.forEach((index) => {
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('class', 'stats-chart-axis-label');
      label.setAttribute('x', String(xForIndex(index)));
      label.setAttribute('y', String(height - 10));
      label.setAttribute('text-anchor', index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle');
      label.textContent = formatPointLabel(points[index]);
      svg.append(label);
    });

    series.forEach((item) => {
      const path = document.createElementNS(ns, 'path');
      const d = points.map((point, index) => {
        const command = index === 0 ? 'M' : 'L';
        return `${command} ${xForIndex(index).toFixed(2)} ${yForValue(point[item.key]).toFixed(2)}`;
      }).join(' ');
      path.setAttribute('class', 'stats-chart-line');
      path.setAttribute('d', d);
      path.setAttribute('stroke', item.color);
      svg.append(path);
    });

    const guide = document.createElementNS(ns, 'line');
    guide.setAttribute('class', 'stats-chart-guide');
    guide.setAttribute('y1', String(padding.top));
    guide.setAttribute('y2', String(padding.top + chartHeight));
    svg.append(guide);

    const pointCircles = [];
    series.forEach((item) => {
      points.forEach((point, index) => {
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('class', 'stats-chart-point');
        circle.setAttribute('data-point-index', String(index));
        circle.setAttribute('cx', String(xForIndex(index)));
        circle.setAttribute('cy', String(yForValue(point[item.key])));
        circle.setAttribute('r', '4');
        circle.setAttribute('fill', item.color);
        svg.append(circle);
        pointCircles.push(circle);
      });
    });

    const tooltip = document.createElement('div');
    tooltip.className = 'stats-chart-tooltip';
    tooltip.hidden = true;

    const clearActivePoint = () => {
      guide.classList.remove('is-active');
      tooltip.hidden = true;
      pointCircles.forEach((circle) => circle.classList.remove('is-active'));
    };

    const setActivePoint = (index) => {
      const point = points[index];
      if (!point) return;
      const x = xForIndex(index);

      guide.setAttribute('x1', String(x));
      guide.setAttribute('x2', String(x));
      guide.classList.add('is-active');
      pointCircles.forEach((circle) => {
        circle.classList.toggle('is-active', circle.getAttribute('data-point-index') === String(index));
      });

      tooltip.replaceChildren();
      const tooltipTitle = document.createElement('div');
      tooltipTitle.className = 'stats-chart-tooltip-title';
      tooltipTitle.textContent = formatPointLabel(point, { includeDate: true, includeYear: true });
      tooltip.append(tooltipTitle);

      series.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'stats-chart-tooltip-row';
        const label = document.createElement('span');
        const swatch = document.createElement('span');
        swatch.className = 'stats-chart-tooltip-swatch';
        swatch.style.background = item.color;
        label.append(swatch, document.createTextNode(item.label));
        const value = document.createElement('strong');
        value.textContent = String(Number(point[item.key] || 0));
        row.append(label, value);
        tooltip.append(row);
      });

      tooltip.hidden = false;
      tooltip.style.left = `${(x / width) * 100}%`;
      tooltip.style.top = `${padding.top + 8}px`;
      tooltip.classList.toggle('is-right-aligned', index > points.length * 0.65);
    };

    points.forEach((point, index) => {
      const hitArea = document.createElementNS(ns, 'rect');
      const previousX = index === 0 ? padding.left : (xForIndex(index - 1) + xForIndex(index)) / 2;
      const nextX = index === points.length - 1
        ? padding.left + chartWidth
        : (xForIndex(index) + xForIndex(index + 1)) / 2;
      hitArea.setAttribute('class', 'stats-chart-hit-area');
      hitArea.setAttribute('x', String(previousX));
      hitArea.setAttribute('y', String(padding.top));
      hitArea.setAttribute('width', String(Math.max(8, nextX - previousX)));
      hitArea.setAttribute('height', String(chartHeight));
      hitArea.setAttribute('tabindex', '0');
      hitArea.setAttribute(
        'aria-label',
        `${formatPointLabel(point, { includeDate: true, includeYear: true })}: ${series
          .map((item) => `${item.label} ${Number(point[item.key] || 0)}`)
          .join(', ')}`
      );
      hitArea.addEventListener('mouseenter', () => setActivePoint(index));
      hitArea.addEventListener('focus', () => setActivePoint(index));
      hitArea.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(points.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))
        );
        svg.querySelector(`[data-hit-index="${nextIndex}"]`)?.focus();
      });
      hitArea.setAttribute('data-hit-index', String(index));
      svg.append(hitArea);
    });

    svg.addEventListener('mouseleave', clearActivePoint);
    svg.addEventListener('blur', (event) => {
      if (!svg.contains(event.relatedTarget)) clearActivePoint();
    }, true);

    elements.statsChart.append(svg, tooltip);
  }

  function makeStatusPill(status, label = status) {
    const pill = document.createElement('span');
    pill.className = `status-pill ${status}`;
    pill.textContent = label;
    return pill;
  }

  function formatCountLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function makeActionIconButton(label, iconName, className) {
    const icons = {
      check: [
        ['path', { d: 'M20 6L9 17l-5-5' }],
      ],
      trash: [
        ['path', { d: 'M3 6h18' }],
        ['path', { d: 'M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2' }],
        ['path', { d: 'M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6' }],
        ['path', { d: 'M10 11v6' }],
        ['path', { d: 'M14 11v6' }],
      ],
      eyeOff: [
        ['path', { d: 'M3 3l18 18' }],
        ['path', { d: 'M10.6 10.6a2 2 0 002.8 2.8' }],
        ['path', { d: 'M9.5 5.1A9.5 9.5 0 0112 4c5 0 9 5 9 8a8.5 8.5 0 01-2.2 3.4' }],
        ['path', { d: 'M6.2 6.2C4.2 7.6 3 9.7 3 12c0 3 4 8 9 8 1.3 0 2.6-.3 3.8-.9' }],
      ],
      eye: [
        ['path', { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' }],
        ['circle', { cx: '12', cy: '12', r: '3' }],
      ],
      x: [
        ['path', { d: 'M18 6L6 18' }],
        ['path', { d: 'M6 6l12 12' }],
      ],
      restore: [
        ['path', { d: 'M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8' }],
        ['path', { d: 'M21 3v5h-5' }],
        ['path', { d: 'M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16' }],
        ['path', { d: 'M3 21v-5h5' }],
      ],
    };
    const button = document.createElement('button');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    button.type = 'button';
    button.className = `icon-button comment-icon-button ${className}`;
    button.setAttribute('aria-label', label);
    button.title = label;

    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    icons[iconName].forEach(([tag, attributes]) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([name, value]) => {
        element.setAttribute(name, value);
      });
      svg.append(element);
    });

    button.append(svg);
    return button;
  }

  function getPostDisplayTitle(pageTitle, path) {
    const rawTitle = String(pageTitle || path || 'Untitled post').trim();
    const rawPath = String(path || '').trim();
    if (rawPath && rawTitle.endsWith(` (${rawPath})`)) {
      return rawTitle.slice(0, -(` (${rawPath})`).length);
    }
    return rawTitle;
  }

  async function copyTextToClipboard(value) {
    const text = String(value || '');
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function makePostTitleButton(pageTitle, path) {
    const displayTitle = getPostDisplayTitle(pageTitle, path);
    const postPath = String(path || '').trim();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'post-title-copy-button';
    button.setAttribute('aria-label', 'Copy post path');

    const label = document.createElement('span');
    label.className = 'post-title-label';
    label.textContent = displayTitle;

    const tooltip = document.createElement('span');
    tooltip.className = 'post-title-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    const tooltipPath = document.createElement('span');
    tooltipPath.className = 'post-title-tooltip-path';
    tooltipPath.textContent = postPath || 'No path available';
    const tooltipHint = document.createElement('span');
    tooltipHint.className = 'post-title-tooltip-hint';
    tooltipHint.textContent = 'Click to copy path';
    tooltip.append(tooltipPath, tooltipHint);

    button.append(label, tooltip);
    button.addEventListener('click', async () => {
      if (!postPath) return;
      await copyTextToClipboard(postPath);
      tooltipHint.textContent = 'copied';
      window.setTimeout(() => {
        tooltipHint.textContent = 'Click to copy path';
      }, 1200);
    });

    return button;
  }

  function makeCommentItem(comment, branchStates = [], isLastReply = false, hasReplies = false, requiresAttention = false) {
    const item = document.createElement('li');
    const depth = branchStates.length;
    const threadContinuesBelow = hasReplies || branchStates.some((state) => state.continues || state.bridgesToChild);
    item.className = [
      'comment-item',
      depth > 0 ? 'comment-item-reply' : '',
      isLastReply ? 'comment-item-reply-last' : '',
      threadContinuesBelow ? 'comment-item-thread-continues' : '',
    ].filter(Boolean).join(' ');
    item.style.setProperty('--comment-depth', String(depth));

    const content = document.createElement('div');
    content.className = 'comment-content';

    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const author = document.createElement('span');
    author.textContent = `${comment.authorName || 'Anonymous'} #${comment.id}`;
    const createdAt = document.createElement('span');
    createdAt.textContent = formatDate(comment.createdAt);
    meta.append(author, createdAt);

    const title = document.createElement('div');
    title.className = 'comment-title';
    title.append(makePostTitleButton(comment.pageTitle, comment.path));

    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = comment.content || '';

    const actions = document.createElement('div');
    actions.className = 'comment-actions';
    const commentSummary = document.createElement('div');
    commentSummary.className = 'comment-summary';
    const commentLikes = Number(comment.likesCount || 0);
    const likeCount = document.createElement('span');
    likeCount.className = 'comment-like-count';
    likeCount.textContent = formatCountLabel(commentLikes, 'like', 'likes');
    title.append(likeCount);
    commentSummary.append(
      requiresAttention
        ? makeStatusPill('attention', 'Requires attention')
        : comment.inactive
            ? makeStatusPill('inactive')
          : comment.hiddenAt
            ? makeStatusPill('hidden')
          : makeStatusPill(comment.status),
    );
    actions.append(commentSummary);

    const actionButtons = document.createElement('div');
    actionButtons.className = 'comment-action-buttons';

    const isRejected = comment.status === 'rejected';
    const approveButton = makeActionIconButton(
      isRejected ? 'Restore comment' : 'Approve comment',
      isRejected ? 'restore' : 'check',
      isRejected ? 'approve-action restore-action' : 'approve-action'
    );
    approveButton.addEventListener('click', () => updateComment(
      comment.id,
      'approve',
      '',
      isRejected
        ? {
            confirmLabel: 'restore',
            confirmMessage: 'This comment includes a denied keyword. Are you sure you want to restore it?',
          }
        : {}
    ));

    const isHidden = Boolean(comment.hiddenAt);
    const isDeleteAction = comment.status === 'approved' || isRejected;
    const rejectButton = makeActionIconButton(
      isDeleteAction ? 'Delete comment' : 'Deny comment',
      isDeleteAction ? 'trash' : 'x',
      isRejected ? 'delete-action rejected-delete-action' : isDeleteAction ? 'delete-action' : 'deny-action'
    );
    rejectButton.addEventListener('click', () => updateComment(
      comment.id,
      isDeleteAction ? 'delete' : 'reject',
      comment.status === 'approved' ? 'delete' : isRejected ? '' : 'deny',
      { hasReplies: hasReplies && comment.status === 'approved' }
    ));

    if (comment.status !== 'approved') {
      actionButtons.append(approveButton);
    } else if (comment.inactive) {
      // Inactive comments inherit visibility from a missing or hidden parent.
    } else if (isHidden) {
      const unhideButton = makeActionIconButton('Unhide approved comment', 'eye', 'unhide-action');
      unhideButton.addEventListener('click', () => updateComment(comment.id, 'unhide'));
      actionButtons.append(unhideButton);
    } else {
      const hideButton = makeActionIconButton('Hide approved comment', 'eyeOff', 'hide-action');
      hideButton.addEventListener('click', () => updateComment(comment.id, 'hide'));
      actionButtons.append(hideButton);
    }
    actionButtons.append(rejectButton);
    actions.append(actionButtons);
    content.append(meta, title, body, actions);
    item.append(content);
    return item;
  }

  function renderComments(comments) {
    elements.commentList.replaceChildren();
    if (!comments.length) {
      setEmpty(elements.commentList, 'No comments found.');
      return;
    }

    const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
    const repliesByParentId = new Map();
    const roots = [];

    const isInactiveComment = (comment, visited = new Set()) => {
      if (!comment.parentId || visited.has(comment.id)) return false;
      visited.add(comment.id);

      const parent = commentsById.get(comment.parentId);
      if (!parent) return true;
      if (parent.hiddenAt) return true;
      return isInactiveComment(parent, visited);
    };

    comments.forEach((comment) => {
      comment.inactive = isInactiveComment(comment);
    });

    comments.forEach((comment) => {
      if (comment.parentId && commentsById.has(comment.parentId)) {
        const replies = repliesByParentId.get(comment.parentId) || [];
        replies.push(comment);
        repliesByParentId.set(comment.parentId, replies);
      } else {
        roots.push(comment);
      }
    });

    const hasPendingDescendant = (comment, visited = new Set()) => {
      if (visited.has(comment.id)) return false;
      visited.add(comment.id);

      return (repliesByParentId.get(comment.id) || []).some((reply) => (
        reply.status === 'pending' || hasPendingDescendant(reply, new Set(visited))
      ));
    };

    const threadRequiresAttention = (comment) => (
      !comment.parentId && comment.status !== 'pending' && hasPendingDescendant(comment)
    );

    const commentNeedsAttention = (comment) => (
      comment.status === 'pending' || hasPendingDescendant(comment)
    );

    repliesByParentId.forEach((replies) => {
      replies.sort((a, b) => {
        const aNeedsAttention = commentNeedsAttention(a);
        const bNeedsAttention = commentNeedsAttention(b);
        if (aNeedsAttention !== bNeedsAttention) return aNeedsAttention ? -1 : 1;
        return Number(a.id) - Number(b.id);
      });
    });

    roots.sort((a, b) => {
      const aNeedsAttention = commentNeedsAttention(a);
      const bNeedsAttention = commentNeedsAttention(b);
      if (aNeedsAttention !== bNeedsAttention) return aNeedsAttention ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const appendThread = (comment, branchStates = [], isLastReply = false, visited = new Set()) => {
      if (visited.has(comment.id)) return;
      visited.add(comment.id);

      const replies = repliesByParentId.get(comment.id) || [];
      elements.commentList.append(makeCommentItem(
        comment,
        branchStates,
        isLastReply,
        replies.length > 0,
        threadRequiresAttention(comment)
      ));
      replies.forEach((reply, index) => {
        const childHasNextSibling = index < replies.length - 1;
        const childBranchStates = branchStates.map((state, stateIndex) => ({
          continues: state.continues,
          bridgesToChild: stateIndex === branchStates.length - 1,
        }));
        childBranchStates.push({
          continues: childHasNextSibling,
          bridgesToChild: false,
        });

        appendThread(
          reply,
          childBranchStates,
          index === replies.length - 1,
          new Set(visited)
        );
      });
    };

    roots.forEach((comment) => {
      appendThread(comment);
    });
  }

  function renderLikes(likes) {
    elements.likesList.replaceChildren();
    if (!likes.length) {
      setEmpty(elements.likesList, 'No likes found.');
      return;
    }
    likes.forEach((like) => {
      const item = document.createElement('li');
      item.className = 'likes-item';
      const meta = document.createElement('div');
      meta.className = 'likes-meta';
      const count = document.createElement('span');
      const commentCount = Number(like.commentCount || 0);
      const commentLikeCount = Number(like.commentLikeCount || 0);
      count.textContent = [
        formatCountLabel(Number(like.count || 0), 'post like', 'post likes'),
        formatCountLabel(commentLikeCount, 'comment like', 'comment likes'),
        formatCountLabel(commentCount, 'comment', 'comments'),
      ].join(' · ');
      const updated = document.createElement('span');
      updated.textContent = formatDate(like.updatedAt);
      meta.append(count, updated);
      const title = document.createElement('div');
      title.className = 'likes-title';
      title.append(makePostTitleButton(like.pageTitle, like.path));
      item.append(meta, title);
      elements.likesList.append(item);
    });
  }

  function updateLikesDirectionLabel() {
    const isMost = elements.likesDirection.dataset.direction !== 'asc';
    const directionLabel = isMost ? 'Most' : 'Least';
    const iconPaths = isMost
      ? ['M7 17h10', 'M7 12h7', 'M7 7h4']
      : ['M7 7h10', 'M7 12h7', 'M7 17h4'];

    elements.likesDirection.classList.toggle('is-most', isMost);
    elements.likesDirection.classList.toggle('is-least', !isMost);
    elements.likesDirection.title = `${directionLabel} first`;
    elements.likesDirection.setAttribute(
      'aria-label',
      `${directionLabel} ${elements.likesSort.selectedOptions[0].textContent.toLowerCase()} first`
    );
    elements.likesDirection.querySelectorAll('[data-likes-direction-icon]').forEach((path, index) => {
      path.setAttribute('d', iconPaths[index]);
    });
  }

  function renderWorker(worker) {
    elements.workerList.replaceChildren();

    const infoItems = [
      ['URL', worker.workerUrl],
      ['Name', worker.workerName || 'Not configured'],
      ['Database', worker.databaseName || 'Not configured'],
      ['Admin key expires', worker.adminKeyExpiresAt ? formatDate(worker.adminKeyExpiresAt) : 'Never'],
      ['Origins', (worker.allowedOrigins || []).join(', ') || 'None configured'],
    ];

    const infoList = document.createElement('ul');
    infoList.className = 'worker-detail-list';
    infoItems.forEach(([label, value]) => {
      const item = document.createElement('li');
      item.className = 'worker-detail-item';
      const meta = document.createElement('div');
      meta.className = 'worker-meta';
      meta.textContent = label;
      const title = document.createElement('div');
      title.className = 'worker-title';
      title.textContent = value;
      item.append(meta, title);
      infoList.append(item);
    });

    const makeSubmenuSummary = (label) => {
      const summary = document.createElement('summary');
      const labelElement = document.createElement('span');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

      labelElement.textContent = label;
      icon.classList.add('worker-submenu-icon');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2.25');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.setAttribute('aria-hidden', 'true');
      path.setAttribute('d', 'M6 9l6 6 6-6');
      icon.append(path);
      summary.append(labelElement, icon);
      return summary;
    };

    const informationItem = document.createElement('li');
    informationItem.className = 'worker-item worker-menu-item';
    const informationDetails = document.createElement('details');
    informationDetails.className = 'worker-submenu';
    informationDetails.open = true;
    const informationSummary = makeSubmenuSummary('Worker information');
    informationDetails.append(informationSummary, infoList);
    informationItem.append(informationDetails);

    const cloudflareItem = document.createElement('li');
    cloudflareItem.className = 'worker-item worker-menu-item';
    const cloudflareLink = document.createElement('a');
    cloudflareLink.className = 'worker-dashboard-link';
    cloudflareLink.href = 'https://dash.cloudflare.com/';
    cloudflareLink.target = '_blank';
    cloudflareLink.rel = 'noreferrer';
    cloudflareLink.setAttribute('aria-label', 'Open Cloudflare dashboard');
    const cloudflareLabel = document.createElement('span');
    cloudflareLabel.textContent = 'Cloudflare dashboard';
    const externalIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    externalIcon.setAttribute('viewBox', '0 0 24 24');
    externalIcon.setAttribute('fill', 'none');
    externalIcon.setAttribute('stroke', 'currentColor');
    externalIcon.setAttribute('stroke-width', '2');
    externalIcon.setAttribute('stroke-linecap', 'round');
    externalIcon.setAttribute('stroke-linejoin', 'round');
    externalIcon.setAttribute('aria-hidden', 'true');
    [
      ['path', { d: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6' }],
      ['path', { d: 'M15 3h6v6' }],
      ['path', { d: 'M10 14L21 3' }],
    ].forEach(([tag, attributes]) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([name, value]) => {
        element.setAttribute(name, value);
      });
      externalIcon.append(element);
    });
    cloudflareLink.append(cloudflareLabel, externalIcon);
    cloudflareItem.append(cloudflareLink);

    elements.workerList.append(informationItem, cloudflareItem);
  }

  function formatAuditAction(action) {
    return String(action || '')
      .replace(/^admin\./, '')
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function renderAuditLogs(auditLogs) {
    elements.auditList.replaceChildren();
    if (!auditLogs.length) {
      setEmpty(elements.auditList, 'No activity logs found.');
      return;
    }

    auditLogs.forEach((log) => {
      const item = document.createElement('li');
      item.className = 'audit-item';

      const meta = document.createElement('div');
      meta.className = 'audit-meta';
      const action = document.createElement('span');
      action.textContent = formatAuditAction(log.action);
      const createdAt = document.createElement('span');
      createdAt.textContent = formatDate(log.createdAt);
      meta.append(action, createdAt);

      const title = document.createElement('div');
      title.className = 'audit-title';
      const status = document.createElement('span');
      status.className = `audit-status ${Number(log.status) >= 400 ? 'is-error' : 'is-ok'}`;
      status.textContent = String(log.status || '');
      const request = document.createElement('span');
      request.textContent = `${log.method || ''} ${log.path || ''}`.trim();
      title.append(status, request);

      const details = document.createElement('div');
      details.className = 'audit-details';
      details.textContent = [
        log.adminKeyFingerprint ? `key ${log.adminKeyFingerprint}` : '',
        log.clientIp ? `ip ${log.clientIp}` : '',
      ].filter(Boolean).join(' · ');

      item.append(meta, title);
      if (details.textContent) item.append(details);
      elements.auditList.append(item);
    });
  }

  async function loadComments() {
    const params = new URLSearchParams({
      status: elements.commentStatus.value,
      limit: elements.commentLimit.value,
    });
    const path = elements.commentPath.value.trim();
    if (path) params.set('path', path);
    const payload = await requestAdmin(`/admin/comments?${params.toString()}`);
    renderComments(payload.comments || []);
  }

  async function loadLikes() {
    const params = new URLSearchParams({
      sort: elements.likesSort.value,
      direction: elements.likesDirection.dataset.direction || 'desc',
      limit: elements.likesLimit.value,
    });
    const path = elements.likesPath.value.trim();
    if (path) params.set('path', path);
    const payload = await requestAdmin(`/admin/likes?${params.toString()}`);
    renderLikes(payload.likes || []);
  }

  async function loadCommentSettings() {
    const payload = await requestAdmin('/admin/comment-settings');
    state.deniedKeywords = payload.deniedKeywords || [];
    renderDeniedKeywordsPopover();
    return payload;
  }

  async function loadStats() {
    clampStatsStartDate();
    const requestId = state.statsRequestId + 1;
    state.statsRequestId = requestId;
    const params = new URLSearchParams({ range: state.statsRange });
    if (state.statsStartDate) params.set('start', state.statsStartDate);
    const payload = await requestAdmin(`/admin/stats?${params.toString()}`);
    if (requestId !== state.statsRequestId) return;
    if (payload.selectedStart && !state.statsStartDatePinned) {
      state.statsStartDate = payload.selectedStart;
      state.statsCalendarMonth = parseDateInputValue(payload.selectedStart);
      updateStatsDatePicker();
    }
    renderStatsChart(payload);
  }

  async function loadAuditLogs() {
    const params = new URLSearchParams({
      limit: elements.auditLimit.value,
    });
    const method = elements.auditMethod.value;
    const path = elements.auditPath.value.trim();
    if (method && method !== 'all') params.set('method', method);
    if (path) params.set('path', path);
    if (state.auditDate) params.set('date', state.auditDate);
    const payload = await requestAdmin(`/admin/audit-logs?${params.toString()}`);
    renderAuditLogs(payload.auditLogs || []);
  }

  async function safeLoadComments() {
    try {
      await loadComments();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      setStatus(state.isAuthenticated ? message : 'Session expired.', true);
    }
  }

  async function safeLoadLikes() {
    try {
      await loadLikes();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      setStatus(state.isAuthenticated ? message : 'Session expired.', true);
    }
  }

  async function safeLoadAuditLogs() {
    try {
      await loadAuditLogs();
    } catch (error) {
      setEmpty(elements.auditList, 'Activity logs are unavailable. Run the latest schema migration.');
    }
  }

  async function safeLoadStats() {
    try {
      await loadStats();
    } catch (error) {
      renderStatsChart({ rangeDays: 30, points: [] });
    }
  }

  function updateStatsRangeButtons() {
    elements.statsRangeButtons.forEach((button) => {
      const active = button.dataset.statsRange === state.statsRange;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  async function updateComment(id, action, destructiveLabel = '', options = {}) {
    const confirmLabel = options.confirmLabel || destructiveLabel;
    if (confirmLabel) {
      const confirmed = await confirmCommentAction(confirmLabel, options.confirmMessage || '');
      if (!confirmed) return;
    }
    if (destructiveLabel === 'delete' && options.hasReplies) {
      const confirmed = await confirmCommentAction(
        'delete replies',
        'This comment has replies. Deleting it will permanently delete those replies as well.'
      );
      if (!confirmed) return;
    }

    const statusVerb = action === 'approve'
      ? 'Approving'
      : action === 'delete'
        ? 'Deleting'
        : action === 'hide'
          ? 'Hiding'
        : 'Denying';
    setStatus(`${statusVerb} comment #${id}...`);
    await requestAdmin(`/admin/comments/${action}`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    await refreshAll();
  }

  async function updateCommentSettings(deniedKeywords, options = {}) {
    setStatus('Saving comment settings...');
    const payload = await requestAdmin('/admin/comment-settings', {
      method: 'POST',
      body: JSON.stringify({ deniedKeywords }),
    });
    state.deniedKeywords = payload.deniedKeywords || [];
    clearPendingKeywordDelete(false);
    renderDeniedKeywordsPopover();
    if (!options.keepPopoverOpen) {
      setKeywordPopoverOpen(false);
    }
    await refreshAll();
    if (options.keepPopoverOpen) {
      setKeywordPopoverOpen(true);
      renderDeniedKeywordsPopover();
    }
    setStatus('Comment settings saved.');
    window.setTimeout(() => setStatus(''), 1800);
  }

  async function addDeniedKeywordFromPopover() {
    const keyword = elements.keywordPopoverInput.value.trim();
    if (!keyword) {
      elements.keywordPopoverInput.focus();
      return;
    }
    if (keyword.length < 2) {
      setStatus('Denied keywords must be at least 2 characters.', true);
      elements.keywordPopoverInput.focus();
      return;
    }

    const nextKeywords = Array.from(new Set([...state.deniedKeywords, keyword]));
    try {
      await updateCommentSettings(nextKeywords);
      elements.keywordPopoverInput.value = '';
      setKeywordPopoverOpen(true);
      elements.keywordPopoverInput.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save denied keyword.';
      setStatus(message, true);
      setKeywordPopoverOpen(true);
      elements.keywordPopoverInput.focus();
    }
  }

  async function removeDeniedKeywordFromPopover(keyword) {
    const nextKeywords = state.deniedKeywords.filter((item) => item !== keyword);
    try {
      await updateCommentSettings(nextKeywords, { keepPopoverOpen: true });
      elements.keywordPopoverInput.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to remove denied keyword.';
      setStatus(message, true);
      setKeywordPopoverOpen(true);
      elements.keywordPopoverInput.focus();
    }
  }

  async function refreshAll() {
    if (!state.workerUrl) {
      setSessionWorker('disconnected');
      showAuthPrompt();
      return;
    }

    setSessionWorker('loading');
    setStatus('Loading...');
    try {
      const [summary, likes, worker] = await Promise.all([
        requestAdmin('/admin/summary'),
        loadLikes(),
        requestAdmin('/admin/worker').then(async (workerPayload) => {
          try {
            await loadCommentSettings();
          } catch (error) {
            state.deniedKeywords = [];
          }
          return workerPayload;
        }),
      ]);
      renderSummary(summary);
      renderWorker(worker);
      await safeLoadStats();
      await loadComments();
      await safeLoadAuditLogs();
      setSessionWorker('connected');
      setStatus('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      setSessionWorker('error');
      setStatus(state.isAuthenticated ? message : 'Session expired.', true);
      if (!state.isAuthenticated) {
        showAuthPrompt('Session expired. Enter the admin key again.');
      }
    }
  }

  async function restoreSessionAfterRefresh() {
    setEmpty(elements.commentList, 'No comments loaded.');
    setEmpty(elements.likesList, 'No likes loaded.');
    setEmpty(elements.workerList, 'No worker loaded.');
    setEmpty(elements.auditList, 'No activity logs loaded.');
    renderStatsChart({ rangeDays: 30, points: [] });

    if (!state.workerUrl) {
      showAuthPrompt();
      return;
    }

    // Fail closed on tampered sessionStorage: a stored worker URL that fails
    // the scheme gate is treated as no session and discarded before any
    // network request (verifyCookieSession also gates on canAttemptCookieSession).
    if (!canAttemptCookieSession(state.workerUrl)) {
      clearAdminSession({ clearWorkerUrl: true });
      setStatus('Saved worker URL is not a secure session origin.', true);
      showAuthPrompt('That worker URL is not allowed for secure sessions. Use https, or http://localhost, http://127.0.0.1, or http://[::1] for local development.');
      return;
    }

    setSessionWorker('loading');
    setStatus('Restoring session...');
    if (await verifyCookieSession()) {
      state.isAuthenticated = true;
      await refreshAll();
      return;
    }

    clearAdminSession({ clearWorkerUrl: false });
    setStatus('Session expired.', true);
    showAuthPrompt('Session expired. Enter the admin key again.');
  }

  elements.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const workerUrl = normalizeWorkerUrl(elements.workerUrl.value);
    const adminKey = elements.adminKey.value.trim();

    if (!workerUrl || !adminKey) {
      setAuthStatus('Worker URL and admin key are required.', true);
      return;
    }

    if (!canAttemptCookieSession(workerUrl)) {
      setAuthStatus('Secure sessions require https. http is allowed only for localhost, 127.0.0.1, or [::1].', true);
      elements.workerUrl.focus();
      return;
    }

    setSessionWorker('loading');
    setAuthStatus('Creating secure session...');
    try {
      state.workerUrl = workerUrl;
      state.isAuthenticated = false;
      const sessionPayload = await createAdminSession(workerUrl, adminKey, 'include');

      if (!sessionPayload?.authenticated || !(await verifyCookieSession(workerUrl))) {
        throw new Error(`Session cookie was not accepted. Add ${window.location.origin} to ALLOWED_ORIGINS and redeploy the Worker.`);
      }

      state.isAuthenticated = true;
      window.sessionStorage.setItem(storageKeys.workerUrl, state.workerUrl);
      elements.adminKey.value = '';
      hideAuthPrompt();
      await refreshAll();
    } catch (error) {
      clearAdminSession({ clearWorkerUrl: false });
      const message = error instanceof Error ? error.message : 'Unable to create session.';
      setSessionWorker('error');
      showAuthPrompt(message);
    }
  });

  elements.sessionActions.forEach((button) => button.addEventListener('click', () => {
    if (state.isAuthenticated) {
      setSessionPopoverOpen(elements.sessionPopover.hidden);
    } else {
      showAuthPrompt();
    }
  }));
  elements.sessionLogout.addEventListener('click', endSession);
  elements.themeToggle.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });
  elements.authClose.addEventListener('click', closeAuthPrompt);
  elements.endSession.addEventListener('click', endSession);
  elements.confirmForm.addEventListener('submit', (event) => {
    event.preventDefault();
    closeConfirmPrompt(true);
  });
  elements.confirmCancel.addEventListener('click', () => {
    closeConfirmPrompt(false);
  });
  elements.confirmClose.addEventListener('click', () => {
    closeConfirmPrompt(false);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.confirmOverlay.hidden) {
      closeConfirmPrompt(false);
    } else if (event.key === 'Escape' && !elements.sessionPopover.hidden) {
      setSessionPopoverOpen(false);
      elements.sessionCard.focus();
    } else if (event.key === 'Escape' && !elements.authOverlay.hidden) {
      closeAuthPrompt();
    } else if (event.key === 'Escape' && !elements.statsDatePopover.hidden) {
      setStatsDatePopoverOpen(false);
      elements.statsDateToggle.focus();
    } else if (event.key === 'Escape' && !elements.auditDatePopover.hidden) {
      setAuditDatePopoverOpen(false);
      elements.auditDateToggle.focus();
    } else if (event.key === 'Escape' && !elements.keywordPopover.hidden) {
      if (state.pendingKeywordDelete) {
        clearPendingKeywordDelete();
        return;
      }
      setKeywordPopoverOpen(false);
      elements.keywordPopoverToggle.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!elements.sessionPopover.hidden && !elements.sessionMenu.contains(event.target)) {
      setSessionPopoverOpen(false);
    }
    if (!elements.statsDatePopover.hidden && !event.target.closest('[data-stats-date-picker]')) {
      setStatsDatePopoverOpen(false);
    }
    if (!elements.auditDatePopover.hidden && !event.target.closest('[data-audit-date-picker]')) {
      setAuditDatePopoverOpen(false);
    }
    if (elements.keywordPopover.hidden) return;
    const isKeywordPopoverClick = elements.keywordPopover.contains(event.target);
    const isKeywordToggleClick = elements.keywordPopoverToggle.contains(event.target);
    if (isKeywordPopoverClick || isKeywordToggleClick) {
      if (state.pendingKeywordDelete && !event.target.closest('[data-denied-keyword]')) {
        clearPendingKeywordDelete();
      }
      return;
    }
    setKeywordPopoverOpen(false);
  });
  elements.logoRefresh.addEventListener('click', () => window.location.reload());
  elements.refresh.addEventListener('click', refreshAll);
  elements.statsDateToggle.addEventListener('click', () => {
    setStatsDatePopoverOpen(elements.statsDateToggle.getAttribute('aria-expanded') !== 'true');
  });
  elements.statsDatePrev.addEventListener('click', () => shiftStatsCalendarMonth(-1));
  elements.statsDateNext.addEventListener('click', () => shiftStatsCalendarMonth(1));
  elements.auditDateToggle.addEventListener('click', () => {
    setAuditDatePopoverOpen(elements.auditDateToggle.getAttribute('aria-expanded') !== 'true');
  });
  elements.auditDatePrev.addEventListener('click', () => shiftAuditCalendarMonth(-1));
  elements.auditDateNext.addEventListener('click', () => shiftAuditCalendarMonth(1));
  elements.keywordPopoverToggle.addEventListener('click', () => {
    setKeywordPopoverOpen(elements.keywordPopoverToggle.getAttribute('aria-expanded') !== 'true');
  });
  elements.keywordPopover.addEventListener('click', (event) => {
    event.stopPropagation();
    if (state.pendingKeywordDelete && !event.target.closest('[data-denied-keyword]')) {
      clearPendingKeywordDelete();
    }
  });
  elements.keywordPopoverForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearPendingKeywordDelete(false);
    await addDeniedKeywordFromPopover();
  });
  elements.keywordPopoverList.addEventListener('click', async (event) => {
    const badge = event.target.closest('[data-denied-keyword]');
    if (!badge) {
      if (state.pendingKeywordDelete) {
        clearPendingKeywordDelete();
      }
      return;
    }

    const keyword = badge.dataset.deniedKeyword || '';
    if (!keyword) return;

    if (state.pendingKeywordDelete === keyword) {
      await removeDeniedKeywordFromPopover(keyword);
      return;
    }

    setPendingKeywordDelete(keyword);
    Array.from(elements.keywordPopoverList.querySelectorAll('[data-denied-keyword]'))
      .find((item) => item.dataset.deniedKeyword === keyword)
      ?.focus();
  });
  elements.statsRangeButtons.forEach((button) => {
    button.setAttribute('aria-pressed', button.classList.contains('is-active') ? 'true' : 'false');
    button.addEventListener('click', async () => {
      state.statsRange = button.dataset.statsRange || '30d';
      state.statsStartDatePinned = false;
      updateStatsRangeButtons();
      setDefaultStatsStartDate(true);
      await safeLoadStats();
    });
  });
  elements.commentStatus.addEventListener('change', safeLoadComments);
  elements.commentLimit.addEventListener('change', safeLoadComments);
  elements.commentPath.addEventListener('input', () => {
    window.clearTimeout(elements.commentPath.searchTimeout);
    elements.commentPath.searchTimeout = window.setTimeout(safeLoadComments, 250);
  });
  elements.likesSort.addEventListener('change', () => {
    updateLikesDirectionLabel();
    safeLoadLikes();
  });
  elements.likesDirection.addEventListener('click', () => {
    elements.likesDirection.dataset.direction =
      elements.likesDirection.dataset.direction === 'asc' ? 'desc' : 'asc';
    updateLikesDirectionLabel();
    safeLoadLikes();
  });
  elements.likesLimit.addEventListener('change', safeLoadLikes);
  elements.likesPath.addEventListener('input', () => {
    window.clearTimeout(elements.likesPath.searchTimeout);
    elements.likesPath.searchTimeout = window.setTimeout(safeLoadLikes, 250);
  });
  elements.auditMethod.addEventListener('change', safeLoadAuditLogs);
  elements.auditLimit.addEventListener('change', safeLoadAuditLogs);
  elements.auditPath.addEventListener('input', () => {
    window.clearTimeout(elements.auditPath.searchTimeout);
    elements.auditPath.searchTimeout = window.setTimeout(safeLoadAuditLogs, 250);
  });
  elements.collapseToggles.forEach((button) => {
    setPanelCollapsed(button, button.getAttribute('aria-expanded') !== 'true');
    button.addEventListener('click', () => togglePanel(button));
  });

  applyTheme(state.theme);
  updateLikesDirectionLabel();
  updateStatsRangeButtons();
  setDefaultStatsStartDate(true);
  setDefaultAuditDate(true);
  setSessionWorker();
  renderDeniedKeywordsPopover();

  restoreSessionAfterRefresh();
})();
