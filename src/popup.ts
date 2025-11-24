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
  chrome.runtime.sendMessage({ action: 'fetchRefunds' }, (resp) => {
    if (!resp) return showError('No response from background script.');
    if (!resp.ok) return showError('Error: ' + (resp.error || 'unknown'));
    render(resp.refunds || []);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = (document.getElementById('refresh') as HTMLButtonElement);
  const toggle = (document.getElementById('dev-toggle') as HTMLInputElement);
  const modeEl = document.getElementById('mode');

  refreshBtn.addEventListener('click', fetchAndRender);

  getStoredDevMode().then((v) => {
    if (toggle) toggle.checked = v;
    if (modeEl) modeEl.textContent = v ? 'DEV' : '';
    fetchAndRender();
  });

  if (toggle) {
    toggle.addEventListener('change', async () => {
      const v = toggle.checked;
      await setStoredDevMode(v);
      if (modeEl) modeEl.textContent = v ? 'DEV' : '';
      fetchAndRender();
    });
  }
});
