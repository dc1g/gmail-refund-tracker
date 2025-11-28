import { DEV_MODE } from './config';

function el(id: string) { return document.getElementById(id)!; }

// Storage for suppressed messages
let suppressedMessageIds = new Set<string>();
let showingSuppressed = false;
let lastRenderedResults: any[] = [];

async function loadSuppressedIds(): Promise<Set<string>> {
  return new Promise((resolve) => {
    chrome.storage.local.get('suppressedMessages', (items: any) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve(new Set());
        return;
      }
      const ids = items.suppressedMessages || [];
      resolve(new Set(ids));
    });
  });
}

async function saveSuppressedIds(ids: Set<string>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ suppressedMessages: Array.from(ids) }, () => {
      resolve();
    });
  });
}

async function suppressMessage(messageId: string) {
  suppressedMessageIds.add(messageId);
  await saveSuppressedIds(suppressedMessageIds);
  render(lastRenderedResults);
}

async function restoreMessage(messageId: string) {
  suppressedMessageIds.delete(messageId);
  await saveSuppressedIds(suppressedMessageIds);
  
  // Check if there are any suppressed messages left
  if (suppressedMessageIds.size === 0 && showingSuppressed) {
    // No more suppressed messages, switch to active view and fetch
    showingSuppressed = false;
    const viewToggleBtn = document.getElementById('view-toggle') as HTMLButtonElement;
    if (viewToggleBtn) {
      viewToggleBtn.classList.remove('showing-suppressed');
      viewToggleBtn.setAttribute('aria-label', 'Show suppressed messages');
    }
    fetchAndRender();
  } else {
    // Just re-render with current data
    render(lastRenderedResults);
  }
}

function getStoredDevMode(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('devMode', (items: any) => {
        if (chrome.runtime && chrome.runtime.lastError) return resolve(DEV_MODE);
        if (items && typeof items.devMode === 'boolean') return resolve(items.devMode);
        resolve(DEV_MODE);
      });
    } catch (e) {
      resolve(DEV_MODE);
    }
  });
}

function setStoredDevMode(v: boolean): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ devMode: v }, () => resolve());
    } catch (e) {
      resolve();
    }
  });
}

function getStoredPeriod(): Promise<number> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('scanPeriodDays', (items: any) => {
        if (chrome.runtime && chrome.runtime.lastError) return resolve(14);
        if (items && typeof items.scanPeriodDays === 'number') return resolve(items.scanPeriodDays);
        resolve(14);
      });
    } catch (e) {
      resolve(14);
    }
  });
}

function setStoredPeriod(v: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ scanPeriodDays: v }, () => resolve());
    } catch (e) {
      resolve();
    }
  });
}

// Manage collapsed sender state in storage. Stores an array of sender keys (strings).
function getStoredCollapsedSenders(): Promise<Set<string>> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('collapsedSenders', (items: any) => {
        if (chrome.runtime && chrome.runtime.lastError) return resolve(new Set<string>());
        const arr = items && Array.isArray(items.collapsedSenders) ? items.collapsedSenders : [];
        resolve(new Set(arr));
      });
    } catch (e) { resolve(new Set<string>()); }
  });
}

// Add a small ripple effect to a button-like element (material-style)
function addRippleTo(el: HTMLElement) {
  if (!el) return;
  // ensure container is positioned so absolutely-positioned ripple fits
  el.style.position = (getComputedStyle(el).position === 'static') ? 'relative' : getComputedStyle(el).position;
  el.addEventListener('pointerdown', (ev) => {
    const r = document.createElement('div');
    r.className = 'ripple-el';
    const rect = el.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    const host = el.querySelector('.ripple') || (() => { const s = document.createElement('div'); s.className = 'ripple'; el.appendChild(s); return s; })();
    host.appendChild(r);
    // cleanup after animation
    setTimeout(() => r.remove(), 700);
  });
}

function setStoredCollapsedSenders(keys: Set<string>): Promise<void> {
  return new Promise((resolve) => {
    try {
      const arr = Array.from(keys);
      chrome.storage.local.set({ collapsedSenders: arr }, () => resolve());
    } catch (e) { resolve(); }
  });
}

function setFooterCachedAt(ms?: number | null) {
  const el = document.getElementById('cached-at');
  if (!el) return;
  try {
    if (!ms) el.textContent = '—';
    else el.textContent = new Date(ms).toLocaleString();
  } catch (e) {
    el.textContent = '—';
  }
}

// Collapse all sender groups (hide their items) and persist the collapsed set
async function collapseAllGroups() {
  const containers = document.querySelectorAll('div[data-group-key]');
  const keys = new Set<string>();
  containers.forEach((c) => {
    const key = (c as HTMLElement).dataset.groupKey;
    if (!key) return;
    keys.add(key);
    (c as HTMLElement).style.display = 'none';
    const header = (c as HTMLElement).previousElementSibling as HTMLElement | null;
    if (header) {
      const caret = header.querySelector('.caret');
      if (caret) (caret as HTMLElement).classList.add('closed');
    }
  });
  await setStoredCollapsedSenders(keys);
  // update toggle label after collapsing
  const toggleBtn = document.getElementById('collapse-toggle') as HTMLButtonElement | null;
  if (toggleBtn) {
    toggleBtn.classList.add('all-collapsed');
    toggleBtn.setAttribute('aria-label', 'Expand all');
  }
}

// Expand all sender groups (show their items) and persist the collapsed set as empty
async function expandAllGroups() {
  const containers = document.querySelectorAll('div[data-group-key]');
  containers.forEach((c) => {
    (c as HTMLElement).style.display = '';
    const header = (c as HTMLElement).previousElementSibling as HTMLElement | null;
    if (header) {
      const caret = header.querySelector('.caret');
      if (caret) (caret as HTMLElement).classList.remove('closed');
    }
  });
  await setStoredCollapsedSenders(new Set());
  // update toggle label after expanding
  const toggleBtn = document.getElementById('collapse-toggle') as HTMLButtonElement | null;
  if (toggleBtn) {
    toggleBtn.classList.remove('all-collapsed');
    toggleBtn.setAttribute('aria-label', 'Collapse all');
  }
}

async function render(refunds: any[]) {
  lastRenderedResults = refunds;
  const list = el('list');
  list.innerHTML = '';
  if (!refunds.length) {
    list.textContent = 'No return/refund emails found.';
    return;
  }
  // Load persisted collapsed sender keys so we render groups in the user's preferred collapsed state
  const collapsedSet = await getStoredCollapsedSenders();

  // Group candidates by sender email. If fromEmail not available, fall back to the raw 'from' header.
  const groups = new Map<string, any>();
  for (const r of refunds) {
    const key = r.fromEmail || r.from || 'unknown';
    if (!groups.has(key)) groups.set(key, { email: r.fromEmail || key, name: r.fromName || '', items: [] });
    groups.get(key).items.push(r);
  }

  // Convert groups to array and sort groups by the most recent item date (descending)
  const groupArray = Array.from(groups.values()).map((g: any) => {
    g.items.sort((a: any, b: any) => {
      const da = a.date ? Date.parse(a.date) : 0;
      const db = b.date ? Date.parse(b.date) : 0;
      return db - da;
    });
    g.mostRecent = g.items.length ? (g.items[0].date ? Date.parse(g.items[0].date) : 0) : 0;
    return g;
  }).sort((a: any, b: any) => b.mostRecent - a.mostRecent);

  // Render each group (email address) with its items (most recent first)
  for (const g of groupArray) {
    // Count only items that match the current view (active or suppressed)
    const visibleItems = g.items.filter((item: any) => {
      const isSuppressed = suppressedMessageIds.has(item.id);
      return showingSuppressed ? isSuppressed : !isSuppressed;
    });
    
    // Skip groups with no visible items
    if (visibleItems.length === 0) continue;
    
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.padding = '6px 0';
    header.style.borderBottom = '1px solid #eee';

    const left = document.createElement('div');
    left.style.fontWeight = '700';
    // caret + sender display
    const caret = document.createElement('button');
    caret.className = 'caret';
    caret.setAttribute('aria-label', 'Toggle group');
    // closed when collapsed
    const groupKey = g.email || 'unknown';
    if (collapsedSet.has(groupKey)) {
      caret.classList.add('closed');
    }
    // show only the sender name in the UI; show full email address on hover via a tooltip element
    const labelSpan = document.createElement('span');
    labelSpan.className = 'sender-name';
    let displayName = (g.name && g.name.trim()) ? g.name : (g.email || 'unknown');
    // Truncate to max 20 characters with ellipsis
    if (displayName.length > 20) {
      displayName = displayName.slice(0, 20) + '...';
    }
    labelSpan.textContent = displayName;
    // tooltip element that appears on hover
    const tooltip = document.createElement('span');
    tooltip.className = 'email-tooltip';
    tooltip.textContent = g.email || '';
    labelSpan.appendChild(tooltip);
    left.appendChild(caret);
    left.appendChild(labelSpan);

    const visibleCount = visibleItems.length;

    const right = document.createElement('div');
    right.style.fontSize = '12px';
    right.style.color = '#666';
    right.textContent = `${visibleCount} item${visibleCount !== 1 ? 's' : ''}` + (g.mostRecent ? ` · ${new Date(g.mostRecent).toLocaleString()}` : '');

    header.appendChild(left);
    header.appendChild(right);
    list.appendChild(header);
    // container for the items in this group
    const itemsContainer = document.createElement('div');
    itemsContainer.dataset['groupKey'] = groupKey;
    // honor persisted collapsed state
    if (collapsedSet.has(groupKey)) itemsContainer.style.display = 'none';

    // toggle handler
    // attach ripple and accessible target
    addRippleTo(caret);
    caret.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const key = groupKey;
      // Determine collapsed state from the DOM (not only from the in-memory set) because expandAll/collapseAll
      // may change DOM visibility without updating the local `collapsedSet` variable.
      const isCollapsed = (itemsContainer.style.display === 'none');
      if (isCollapsed) {
        // currently collapsed -> expand
        itemsContainer.style.display = '';
        caret.classList.remove('closed');
        collapsedSet.delete(key);
      } else {
        // currently expanded -> collapse
        itemsContainer.style.display = 'none';
        caret.classList.add('closed');
        collapsedSet.add(key);
      }
      await setStoredCollapsedSenders(collapsedSet);
      // update the top-level toggle label so it reflects current state
      const toggleBtn = document.getElementById('collapse-toggle') as HTMLButtonElement | null;
      if (toggleBtn) {
        // if any group remains visible then show Collapse all, otherwise show Expand all
        const containers = document.querySelectorAll('div[data-group-key]');
        let anyVisible = false;
        containers.forEach((c) => { if ((c as HTMLElement).style.display !== 'none') anyVisible = true; });
        if (anyVisible) {
          toggleBtn.classList.remove('all-collapsed');
          toggleBtn.setAttribute('aria-label', 'Collapse all');
        } else {
          toggleBtn.classList.add('all-collapsed');
          toggleBtn.setAttribute('aria-label', 'Expand all');
        }
      }
    });

    for (const r of g.items) {
      // Filter based on current view mode
      const isSuppressed = suppressedMessageIds.has(r.id);
      if (showingSuppressed && !isSuppressed) continue;
      if (!showingSuppressed && isSuppressed) continue;

      const item = document.createElement('div');
      item.className = 'item';
      item.style.position = 'relative';

      // Main clickable area
      const clickableArea = document.createElement('div');
      clickableArea.style.cursor = 'pointer';
      clickableArea.addEventListener('click', () => {
        const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${r.id}`;
        window.open(gmailUrl, '_blank');
      });

      const title = document.createElement('div');
      title.className = 'subject';
      title.textContent = r.subject || '(no subject)';

      const meta = document.createElement('div');
      meta.style.display = 'flex';
      meta.style.justifyContent = 'space-between';
      meta.style.marginBottom = '6px';

      const status = document.createElement('div');
      status.className = 'status';
      status.textContent = r.status === 'pending' ? 'Pending refund' : 'Refund received';

      const dateDiv = document.createElement('div');
      dateDiv.style.fontSize = '12px';
      dateDiv.style.color = '#666';
      dateDiv.textContent = r.date ? new Date(r.date).toLocaleString() : '';

      meta.appendChild(status);
      meta.appendChild(dateDiv);

      const snippet = document.createElement('pre');
      snippet.className = 'snippet';
      snippet.textContent = r.snippet || '';

      clickableArea.appendChild(title);
      clickableArea.appendChild(meta);
      clickableArea.appendChild(snippet);
      item.appendChild(clickableArea);

      // Add suppress/restore button
      const actionBtn = document.createElement('button');
      actionBtn.className = showingSuppressed ? 'restore-btn' : 'suppress-btn';
      actionBtn.setAttribute('aria-label', showingSuppressed ? 'Restore message' : 'Suppress message');
      actionBtn.textContent = showingSuppressed ? '✓' : '✕';
      actionBtn.style.fontSize = '16px';
      actionBtn.style.fontWeight = 'bold';
      actionBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (showingSuppressed) {
          await restoreMessage(r.id);
        } else {
          await suppressMessage(r.id);
        }
      });
      item.appendChild(actionBtn);

      if (r.status === 'pending') item.style.background = 'var(--status-pending-bg)';
      else item.style.background = 'var(--status-refunded-bg)';
      itemsContainer.appendChild(item);
    }
    list.appendChild(itemsContainer);
  }
}

function showError(msg: string) {
  el('list').textContent = msg;
}

function fetchAndRender() {
  const periodSelect = (document.getElementById('period-select') as HTMLSelectElement | null);
  const periodDays = periodSelect ? Number(periodSelect.value) : 14;
  const progressEl = document.getElementById('progress');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const refreshBtn = (document.getElementById('refresh') as HTMLButtonElement | null);
  if (progressEl) progressEl.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = '0 / 0';
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('loading');
  }

  // attach ripple to top-level buttons so clicks feel material
  const refreshBtnDom = document.getElementById('refresh') as HTMLElement | null;
  if (refreshBtnDom) addRippleTo(refreshBtnDom);
  const collapseToggleDom = document.getElementById('collapse-toggle') as HTMLElement | null;
  if (collapseToggleDom) addRippleTo(collapseToggleDom);

  chrome.runtime.sendMessage({ action: 'fetchRefunds', periodDays }, (resp) => {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('loading');
    }
    if (progressEl) progressEl.style.display = 'none';
    if (!resp) return showError('No response from background script.');
    if (!resp.ok) return showError('Error: ' + (resp.error || 'unknown'));
    render(resp.refunds || []);
    // after a fetch completes, try to update the cached timestamp in the footer
    try {
      const cacheKey = `refunds_${periodDays}`;
      chrome.storage.local.get(cacheKey, (items: any) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        const cached = items && items[cacheKey];
        setFooterCachedAt(cached && cached.fetchedAt ? cached.fetchedAt : undefined);
      });
    } catch (e) {
      setFooterCachedAt(undefined);
    }
  });
}

// Listen for progress updates from the background and update the bar
chrome.runtime.onMessage.addListener((msg: any) => {
  if (!msg || msg.action !== 'fetchProgress') return;
  const total = Number(msg.total) || 0;
  const done = Number(msg.done) || 0;
  const progressEl = document.getElementById('progress');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  if (progressEl) progressEl.style.display = 'block';
  if (progressBar) progressBar.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
  if (progressText) progressText.textContent = `${done} / ${total}`;
});

document.addEventListener('DOMContentLoaded', async () => {
  // Load suppressed message IDs
  suppressedMessageIds = await loadSuppressedIds();

  const refreshBtn = (document.getElementById('refresh') as HTMLButtonElement);
  const toggle = (document.getElementById('dev-toggle') as HTMLInputElement);
  const viewToggleBtn = (document.getElementById('view-toggle') as HTMLButtonElement);

  refreshBtn.addEventListener('click', fetchAndRender);

  // Eye toggle button for active/suppressed view
  if (viewToggleBtn) {
    viewToggleBtn.addEventListener('click', () => {
      showingSuppressed = !showingSuppressed;
      viewToggleBtn.classList.toggle('showing-suppressed', showingSuppressed);
      viewToggleBtn.setAttribute('aria-label', showingSuppressed ? 'Show active messages' : 'Show suppressed messages');
      // If switching back to active view, re-fetch to show any restored messages
      if (!showingSuppressed) {
        fetchAndRender();
      } else {
        render(lastRenderedResults || []);
      }
    });
  }

  getStoredDevMode().then((v) => {
    if (toggle) toggle.checked = v;
    const periodSelect = (document.getElementById('period-select') as HTMLSelectElement | null);
    // initialize the period select from stored preference, then try to load cached results
    getStoredPeriod().then((p) => {
      if (periodSelect) periodSelect.value = String(p);
      // try to load cached results (key: refunds_<days>) and only run the query if cache missing
      const cacheKey = `refunds_${p}`;
      try {
        chrome.storage.local.get(cacheKey, (items: any) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            // storage read failed -> run query
            fetchAndRender();
            return;
          }
          const cached = items && items[cacheKey];
          if (cached && Array.isArray(cached.results) && cached.results.length) {
            // render cached results and do not re-run query automatically
            render(cached.results || []);
            // show cached timestamp in footer
            setFooterCachedAt(cached.fetchedAt);
          } else {
            fetchAndRender();
          }
        });
      } catch (e) {
        fetchAndRender();
      }
    });
    // after a fetch completes, try to update the cached timestamp in the footer
    try {
      const cacheKey = `refunds_${periodDays}`;
      chrome.storage.local.get(cacheKey, (items: any) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        const cached = items && items[cacheKey];
        setFooterCachedAt(cached && cached.fetchedAt ? cached.fetchedAt : undefined);
      });
    } catch (e) {
      setFooterCachedAt(undefined);
    }
  });

  if (toggle) {
    toggle.addEventListener('change', async () => {
      const v = toggle.checked;
      await setStoredDevMode(v);
      /* no visible DEV label anymore; mock mode is controlled by the checkbox stored in chrome.storage */
      fetchAndRender();
    });
  }
  const periodSelect = (document.getElementById('period-select') as HTMLSelectElement | null);
  if (periodSelect) {
    periodSelect.addEventListener('change', async () => {
      const val = Number(periodSelect.value) || 14;
      await setStoredPeriod(val);
      fetchAndRender();
    });
  }
  // collapse toggle button — set initial label and event handler
  const collapseToggleBtn = document.getElementById('collapse-toggle') as HTMLButtonElement | null;
  if (collapseToggleBtn) {
    // Ensure the button contains the two icon svgs. Older versions may have replaced contents with text,
    // which would prevent the CSS icons from displaying. Reinsert icons when missing.
    if (!collapseToggleBtn.querySelector('.icon')) {
      collapseToggleBtn.innerHTML = `
        <svg class="icon icon-minus" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg class="icon icon-plus" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      `;
    }
    // initialize icon state from storage: if there are any collapsed keys, show plus (all-collapsed), otherwise show minus
    getStoredCollapsedSenders().then((set) => {
      if (set.size) collapseToggleBtn.classList.add('all-collapsed');
      else collapseToggleBtn.classList.remove('all-collapsed');
      collapseToggleBtn.setAttribute('aria-label', set.size ? 'Expand all' : 'Collapse all');
    });
    collapseToggleBtn.addEventListener('click', async () => {
      // determine if any group is currently visible; if so, collapse all, otherwise expand all
      const containers = document.querySelectorAll('div[data-group-key]');
      let anyVisible = false;
      containers.forEach((c) => {
        const el = c as HTMLElement;
        if (el.style.display !== 'none') anyVisible = true;
      });
      if (anyVisible) {
        await collapseAllGroups();
        collapseToggleBtn.classList.add('all-collapsed');
        collapseToggleBtn.setAttribute('aria-label', 'Expand all');
      } else {
        await expandAllGroups();
        collapseToggleBtn.classList.remove('all-collapsed');
        collapseToggleBtn.setAttribute('aria-label', 'Collapse all');
      }
    });
  }
});
