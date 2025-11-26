import { DEV_MODE } from './config';

function el(id: string) { return document.getElementById(id)!; }

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

function setStoredCollapsedSenders(keys: Set<string>): Promise<void> {
  return new Promise((resolve) => {
    try {
      const arr = Array.from(keys);
      chrome.storage.local.set({ collapsedSenders: arr }, () => resolve());
    } catch (e) { resolve(); }
  });
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
  if (toggleBtn) toggleBtn.textContent = 'Expand all';
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
  if (toggleBtn) toggleBtn.textContent = 'Collapse all';
}

async function render(refunds: any[]) {
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
    const labelSpan = document.createElement('span');
    labelSpan.textContent = g.name ? `${g.name} <${g.email}>` : g.email;
    left.appendChild(caret);
    left.appendChild(labelSpan);

    const right = document.createElement('div');
    right.style.fontSize = '12px';
    right.style.color = '#666';
    right.textContent = `${g.items.length} item${g.items.length > 1 ? 's' : ''}` + (g.mostRecent ? ` · ${new Date(g.mostRecent).toLocaleString()}` : '');

    header.appendChild(left);
    header.appendChild(right);
    list.appendChild(header);
    // container for the items in this group
    const itemsContainer = document.createElement('div');
    itemsContainer.dataset['groupKey'] = groupKey;
    // honor persisted collapsed state
    if (collapsedSet.has(groupKey)) itemsContainer.style.display = 'none';

    // toggle handler
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
        toggleBtn.textContent = anyVisible ? 'Collapse all' : 'Expand all';
      }
    });

    for (const r of g.items) {
      const item = document.createElement('div');
      item.className = 'item';
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

      if (r.status === 'pending') item.style.background = '#fff7e6';
      else item.style.background = '#e6fff0';
      item.appendChild(title);
      item.appendChild(meta);
      item.appendChild(snippet);
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
  if (refreshBtn) refreshBtn.disabled = true;

  chrome.runtime.sendMessage({ action: 'fetchRefunds', periodDays }, (resp) => {
    if (refreshBtn) refreshBtn.disabled = false;
    if (progressEl) progressEl.style.display = 'none';
    if (!resp) return showError('No response from background script.');
    if (!resp.ok) return showError('Error: ' + (resp.error || 'unknown'));
    render(resp.refunds || []);
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

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = (document.getElementById('refresh') as HTMLButtonElement);
  const toggle = (document.getElementById('dev-toggle') as HTMLInputElement);
  const modeEl = document.getElementById('mode');

  refreshBtn.addEventListener('click', fetchAndRender);

  getStoredDevMode().then((v) => {
    if (toggle) toggle.checked = v;
    if (modeEl) modeEl.textContent = v ? 'DEV' : '';
    const periodSelect = (document.getElementById('period-select') as HTMLSelectElement | null);
    // initialize the period select from stored preference, then fetch
    getStoredPeriod().then((p) => {
      if (periodSelect) periodSelect.value = String(p);
      fetchAndRender();
    });
  });

  if (toggle) {
    toggle.addEventListener('change', async () => {
      const v = toggle.checked;
      await setStoredDevMode(v);
      if (modeEl) modeEl.textContent = v ? 'DEV' : '';
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
    // initialize label from storage: if there are any collapsed keys, offer to Expand all; otherwise Collapse all
    getStoredCollapsedSenders().then((set) => { collapseToggleBtn.textContent = set.size ? 'Expand all' : 'Collapse all'; });
    collapseToggleBtn.addEventListener('click', async () => {
      // determine if any group is currently visible; if so, collapse all, otherwise expand all
      const containers = document.querySelectorAll('div[data-group-key]');
      let anyVisible = false;
      containers.forEach((c) => {
        const el = c as HTMLElement;
        if (el.style.display !== 'none') anyVisible = true;
      });
      if (anyVisible) await collapseAllGroups();
      else await expandAllGroups();
      // update button label
      collapseToggleBtn.textContent = anyVisible ? 'Expand all' : 'Collapse all';
    });
  }
});
