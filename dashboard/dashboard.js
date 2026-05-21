(function() {
  const storageKeys = {
    workerUrl: 'thread-cf:admin:workerUrl',
    adminKey: 'thread-cf:admin:adminKey',
    theme: 'thread-cf:admin:theme',
  };

  const state = {
    workerUrl: window.sessionStorage.getItem(storageKeys.workerUrl) || '',
    adminKey: window.sessionStorage.getItem(storageKeys.adminKey) || '',
    theme: window.localStorage.getItem(storageKeys.theme) || 'light',
    statsRange: '30d',
    statsStartDatePinned: false,
    deniedKeywords: [],
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
    sessionCard: document.querySelector('[data-session-card]'),
    sessionWorker: document.querySelector('[data-session-worker]'),
    sessionActions: document.querySelectorAll('[data-session-action]'),
    status: document.querySelector('[data-status]'),
    themeToggle: document.querySelector('[data-theme-toggle]'),
    refresh: document.querySelector('[data-refresh]'),
    pageLikes: document.querySelector('[data-page-likes]'),
    commentLikes: document.querySelector('[data-comment-likes]'),
    pendingComments: document.querySelector('[data-pending-comments]'),
    approvedComments: document.querySelector('[data-approved-comments]'),
    statsChart: document.querySelector('[data-stats-chart]'),
    statsLegend: document.querySelector('[data-stats-legend]'),
    statsRangeButtons: document.querySelectorAll('[data-stats-range]'),
    statsStartDate: document.querySelector('[data-stats-start-date]'),
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
    auditLimit: document.querySelector('[data-audit-limit]'),
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
    const hasSession = Boolean(state.workerUrl && state.adminKey);
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

  function clearAdminSession() {
    state.workerUrl = '';
    state.adminKey = '';
    window.sessionStorage.removeItem(storageKeys.workerUrl);
    window.sessionStorage.removeItem(storageKeys.adminKey);
    setSessionWorker();
  }

  function endSession() {
    clearAdminSession();
    window.location.reload();
  }

  function showAuthPrompt(message) {
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
    if (!state.workerUrl || !state.adminKey) {
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

  function confirmCommentAction(actionLabel) {
    const submitLabel = actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1);
    elements.confirmMessage.textContent =
      `Are you sure you want to ${actionLabel} this comment?`;
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
    clearAdminSession();
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

  async function requestAdmin(path, options) {
    if (!state.workerUrl || !state.adminKey) {
      showAuthPrompt();
      throw new Error('Worker URL and admin key are required.');
    }

    const response = await fetch(endpoint(path), {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${state.adminKey}`,
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

  function setKeywordPopoverOpen(open) {
    elements.keywordPopover.hidden = !open;
    elements.keywordPopoverToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
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
      item.textContent = keyword;
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
      x: [
        ['path', { d: 'M18 6L6 18' }],
        ['path', { d: 'M6 6l12 12' }],
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
    title.textContent = `${comment.pageTitle || comment.path} (${comment.path})`;

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
        : makeStatusPill(comment.status),
    );
    actions.append(commentSummary);

    const actionButtons = document.createElement('div');
    actionButtons.className = 'comment-action-buttons';

    const approveButton = makeActionIconButton('Approve comment', 'check', 'approve-action');
    approveButton.addEventListener('click', () => updateComment(comment.id, 'approve'));

    const isDeleteAction = comment.status === 'approved';
    const rejectButton = makeActionIconButton(
      isDeleteAction ? 'Delete comment' : 'Deny comment',
      isDeleteAction ? 'trash' : 'x',
      isDeleteAction ? 'delete-action' : 'deny-action'
    );
    rejectButton.disabled = comment.status === 'rejected';
    rejectButton.addEventListener('click', () => updateComment(
      comment.id,
      'reject',
      isDeleteAction ? 'delete' : 'deny'
    ));

    if (comment.status !== 'approved') {
      actionButtons.append(approveButton);
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
      title.textContent = like.path;
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

    const commandsItem = document.createElement('li');
    commandsItem.className = 'worker-item worker-menu-item';
    const commandsDetails = document.createElement('details');
    commandsDetails.className = 'worker-submenu worker-command-submenu';
    const commandsSummary = makeSubmenuSummary('Worker commands');

    const commandForm = document.createElement('form');
    commandForm.className = 'worker-command-form';

    const commandInput = document.createElement('textarea');
    commandInput.rows = 1;
    commandInput.spellcheck = false;
    commandInput.placeholder = `curl -i "${worker.workerUrl || state.workerUrl}/likes?path=/example"`;
    commandInput.setAttribute('aria-label', 'Custom Worker command');

    const runButton = document.createElement('button');
    runButton.type = 'submit';
    runButton.className = 'primary-button worker-command-run';
    runButton.setAttribute('aria-label', 'Run command');
    runButton.title = 'Run command';
    const runIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    runIcon.setAttribute('viewBox', '0 0 24 24');
    runIcon.setAttribute('fill', 'none');
    runIcon.setAttribute('stroke', 'currentColor');
    runIcon.setAttribute('stroke-width', '2.1');
    runIcon.setAttribute('stroke-linecap', 'round');
    runIcon.setAttribute('stroke-linejoin', 'round');
    runIcon.setAttribute('aria-hidden', 'true');
    [
      ['polyline', { points: '4 17 10 11 4 5' }],
      ['line', { x1: '12', y1: '19', x2: '20', y2: '19' }],
    ].forEach(([tag, attributes]) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([name, value]) => {
        element.setAttribute(name, value);
      });
      runIcon.append(element);
    });
    runButton.append(runIcon);

    const commandOutput = document.createElement('pre');
    commandOutput.className = 'worker-command-output';
    commandOutput.textContent = 'Ready.';

    const workerBaseUrl = worker.workerUrl || state.workerUrl;
    const defaultCommand = `curl -i "${workerBaseUrl}/likes?path=/path"`;

    const resizeCommandInput = () => {
      commandInput.style.height = 'auto';
      commandInput.style.height = `${commandInput.scrollHeight}px`;
      runButton.style.height = commandInput.style.height;
    };

    const tokenizeCommand = (value) => {
      const tokens = [];
      let current = '';
      let quote = '';
      let escaped = false;

      Array.from(value).forEach((character) => {
        if (escaped) {
          current += character;
          escaped = false;
          return;
        }
        if (character === '\\') {
          escaped = true;
          return;
        }
        if (quote) {
          if (character === quote) {
            quote = '';
          } else {
            current += character;
          }
          return;
        }
        if (character === '"' || character === "'") {
          quote = character;
          return;
        }
        if (/\s/.test(character)) {
          if (current) {
            tokens.push(current);
            current = '';
          }
          return;
        }
        current += character;
      });

      if (current) tokens.push(current);
      return tokens;
    };

    const resolveCommandUrl = (value) => {
      if (value.startsWith('/')) return endpoint(value);
      return new URL(value).toString();
    };

    const parseWorkerCommand = (value) => {
      const trimmed = value.trim();
      if (!trimmed) throw new Error('Enter a Worker endpoint or curl command.');
      if (!trimmed.startsWith('curl ')) {
        return {
          display: trimmed,
          url: resolveCommandUrl(trimmed),
          options: { method: 'GET', headers: { Accept: 'application/json' } },
        };
      }

      const tokens = tokenizeCommand(trimmed).slice(1);
      const headers = { Accept: 'application/json' };
      let method = 'GET';
      let body = null;
      let url = '';

      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === '-i' || token === '--include' || token === '-s' || token === '--silent') continue;
        if (token === '-X' || token === '--request') {
          method = String(tokens[index + 1] || method).toUpperCase();
          index += 1;
          continue;
        }
        if (token.startsWith('-X') && token.length > 2) {
          method = token.slice(2).toUpperCase();
          continue;
        }
        if (token === '-H' || token === '--header') {
          const header = String(tokens[index + 1] || '');
          const separatorIndex = header.indexOf(':');
          if (separatorIndex > 0) {
            headers[header.slice(0, separatorIndex).trim()] = header.slice(separatorIndex + 1).trim();
          }
          index += 1;
          continue;
        }
        if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
          body = String(tokens[index + 1] || '');
          if (method === 'GET') method = 'POST';
          index += 1;
          continue;
        }
        if (!token.startsWith('-')) url = token;
      }

      if (!url) throw new Error('The curl command needs a URL.');
      return {
        display: trimmed,
        url: resolveCommandUrl(url),
        options: { method, headers, ...(body === null ? {} : { body }) },
      };
    };

    const formatWorkerResponse = async (response) => {
      const contentType = response.headers.get('content-type') || '';
      const responseBody = contentType.includes('application/json')
        ? JSON.stringify(await response.json(), null, 2)
        : await response.text();
      const headers = Array.from(response.headers.entries())
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n');
      return [
        `HTTP ${response.status} ${response.statusText}`.trim(),
        headers,
        '',
        responseBody,
      ].join('\n');
    };

    const runWorkerCommand = async (commandValue) => {
      const command = parseWorkerCommand(commandValue);
      const requestUrl = new URL(command.url);
      const workerUrl = new URL(workerBaseUrl);
      const hasHeader = (headerName) => Object.keys(command.options.headers)
        .some((name) => name.toLowerCase() === headerName.toLowerCase());

      if (requestUrl.origin === workerUrl.origin && requestUrl.pathname.startsWith('/admin/')) {
        if (!hasHeader('Authorization') && !hasHeader('X-Admin-Key')) {
          command.options.headers.Authorization = `Bearer ${state.adminKey}`;
        }
      }

      if (command.options.body && !hasHeader('Content-Type')) {
        command.options.headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(requestUrl.toString(), command.options);
      const output = await formatWorkerResponse(response);
      if (!response.ok && response.status === 401) handleExpiredSession();
      return output;
    };

    commandInput.value = defaultCommand;
    resizeCommandInput();
    commandInput.addEventListener('input', resizeCommandInput);

    commandForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const commandPath = commandInput.value.trim() || defaultCommand;
      runButton.disabled = true;
      commandOutput.textContent = `Running ${commandPath}...`;
      try {
        commandOutput.textContent = await runWorkerCommand(commandPath);
      } catch (error) {
        commandOutput.textContent = error instanceof Error ? error.message : 'Command failed.';
      } finally {
        runButton.disabled = false;
      }
    });

    commandForm.append(commandInput, runButton);
    commandsDetails.append(commandsSummary, commandForm, commandOutput);
    commandsItem.append(commandsDetails);

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

    elements.workerList.append(informationItem, commandsItem, cloudflareItem);
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
    const payload = await requestAdmin(`/admin/stats?range=${encodeURIComponent(state.statsRange)}`);
    renderStatsChart(payload);
  }

  async function loadAuditLogs() {
    const params = new URLSearchParams({
      limit: elements.auditLimit.value,
    });
    const payload = await requestAdmin(`/admin/audit-logs?${params.toString()}`);
    renderAuditLogs(payload.auditLogs || []);
  }

  async function safeLoadComments() {
    try {
      await loadComments();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      setStatus(state.adminKey ? message : 'Session expired.', true);
    }
  }

  async function safeLoadLikes() {
    try {
      await loadLikes();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      setStatus(state.adminKey ? message : 'Session expired.', true);
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

  async function updateComment(id, action, destructiveLabel = '') {
    if (destructiveLabel) {
      const confirmed = await confirmCommentAction(destructiveLabel);
      if (!confirmed) return;
    }

    const statusVerb = action === 'approve'
      ? 'Approving'
      : destructiveLabel === 'delete'
        ? 'Deleting'
        : 'Denying';
    setStatus(`${statusVerb} comment #${id}...`);
    await requestAdmin(`/admin/comments/${action}`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    await refreshAll();
  }

  async function updateCommentSettings(deniedKeywords) {
    setStatus('Saving comment settings...');
    const payload = await requestAdmin('/admin/comment-settings', {
      method: 'PUT',
      body: JSON.stringify({ deniedKeywords }),
    });
    state.deniedKeywords = payload.deniedKeywords || [];
    renderDeniedKeywordsPopover();
    setKeywordPopoverOpen(false);
    await refreshAll();
    setStatus('Comment settings saved.');
    window.setTimeout(() => setStatus(''), 1800);
  }

  async function addDeniedKeywordFromPopover() {
    const keyword = elements.keywordPopoverInput.value.trim();
    if (!keyword) {
      elements.keywordPopoverInput.focus();
      return;
    }

    const nextKeywords = Array.from(new Set([...state.deniedKeywords, keyword]));
    elements.keywordPopoverInput.value = '';
    await updateCommentSettings(nextKeywords);
    setKeywordPopoverOpen(true);
    elements.keywordPopoverInput.focus();
  }

  async function refreshAll() {
    if (!state.workerUrl || !state.adminKey) {
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
      setStatus(state.adminKey ? message : 'Session expired.', true);
    }
  }

  elements.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const workerUrl = normalizeWorkerUrl(elements.workerUrl.value);
    const adminKey = elements.adminKey.value.trim();

    if (!workerUrl || !adminKey) {
      setAuthStatus('Worker URL and admin key are required.', true);
      return;
    }

    state.workerUrl = workerUrl;
    state.adminKey = adminKey;
    window.sessionStorage.setItem(storageKeys.workerUrl, state.workerUrl);
    window.sessionStorage.setItem(storageKeys.adminKey, state.adminKey);
    setSessionWorker('loading');
    hideAuthPrompt();
    await refreshAll();
  });

  elements.sessionActions.forEach((button) => button.addEventListener('click', () => {
    showAuthPrompt();
  }));
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
    } else if (event.key === 'Escape' && !elements.authOverlay.hidden) {
      closeAuthPrompt();
    } else if (event.key === 'Escape' && !elements.keywordPopover.hidden) {
      setKeywordPopoverOpen(false);
      elements.keywordPopoverToggle.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (elements.keywordPopover.hidden) return;
    if (event.target.closest('.comment-keyword-filter')) return;
    setKeywordPopoverOpen(false);
  });
  elements.refresh.addEventListener('click', refreshAll);
  elements.keywordPopoverToggle.addEventListener('click', () => {
    setKeywordPopoverOpen(elements.keywordPopoverToggle.getAttribute('aria-expanded') !== 'true');
  });
  elements.keywordPopoverForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await addDeniedKeywordFromPopover();
  });
  elements.statsRangeButtons.forEach((button) => {
    button.setAttribute('aria-pressed', button.classList.contains('is-active') ? 'true' : 'false');
    button.addEventListener('click', async () => {
      state.statsRange = button.dataset.statsRange || '30d';
      updateStatsRangeButtons();
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
  elements.auditLimit.addEventListener('change', safeLoadAuditLogs);
  elements.collapseToggles.forEach((button) => {
    setPanelCollapsed(button, button.getAttribute('aria-expanded') !== 'true');
    button.addEventListener('click', () => togglePanel(button));
  });

  applyTheme(state.theme);
  updateLikesDirectionLabel();
  updateStatsRangeButtons();
  setSessionWorker();
  renderDeniedKeywordsPopover();

  if (state.workerUrl && state.adminKey) {
    refreshAll();
  } else {
    setEmpty(elements.commentList, 'No comments loaded.');
    setEmpty(elements.likesList, 'No likes loaded.');
    setEmpty(elements.workerList, 'No worker loaded.');
    setEmpty(elements.auditList, 'No activity logs loaded.');
    renderStatsChart({ rangeDays: 30, points: [] });
    showAuthPrompt();
  }
})();
