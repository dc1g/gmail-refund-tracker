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

function render(refunds: any[]) {
  const list = el('list');
  list.innerHTML = '';
  if (!refunds.length) {
    list.textContent = 'No return/refund emails found.';
    return;
  }
  for (const r of refunds) {
    const item = document.createElement('div');
    item.className = 'item';
    const title = document.createElement('div');
    title.className = 'subject';
    title.textContent = r.subject;
    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = r.status === 'pending' ? 'Pending refund' : 'Refund received';
    if (r.status === 'pending') item.style.background = '#fff7e6';
    else item.style.background = '#e6fff0';
    const snippet = document.createElement('pre');
    snippet.className = 'snippet';
    snippet.textContent = r.snippet;
    item.appendChild(title);
    item.appendChild(status);
    item.appendChild(snippet);
    list.appendChild(item);
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
});
