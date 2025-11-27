import { DEV_MODE, MOCK_REFUNDS } from './config';

function getRuntimeDevMode(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('devMode', (items: any) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          return resolve(DEV_MODE);
        }
        if (items && typeof items.devMode === 'boolean') return resolve(items.devMode);
        resolve(DEV_MODE);
      });
    } catch (e) {
      resolve(DEV_MODE);
    }
  });
}

async function getToken(interactive = true): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      (chrome as any).identity.getAuthToken({ interactive }, (token: string) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(token);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function decodeBase64Url(s: string) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try {
    return atob(s);
  } catch (e) {
    return '';
  }
}

function extractBody(payload: any): string {
  if (!payload) return '';
  if (payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts && payload.parts.length) {
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result) return result;
    }
  }
  return '';
}

function cleanSnippet(text: string): string {
  // Remove script tags and their content (case insensitive, handles attributes)
  let cleaned = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  // Remove style tags and their content (case insensitive, handles attributes)
  cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  // Remove DOCTYPE declarations
  cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/gi, '');
  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
  // Remove all HTML tags (including self-closing)
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  // Remove CSS @font-face and other @-rules that might remain
  cleaned = cleaned.replace(/@[a-z-]+\s*\{[^}]*\}/gi, '');
  // Remove any remaining curly brace blocks (likely CSS)
  cleaned = cleaned.replace(/\{[^}]*\}/g, '');
  // Decode common HTML entities
  cleaned = cleaned.replace(/&nbsp;/g, ' ');
  cleaned = cleaned.replace(/&amp;/g, '&');
  cleaned = cleaned.replace(/&lt;/g, '<');
  cleaned = cleaned.replace(/&gt;/g, '>');
  cleaned = cleaned.replace(/&quot;/g, '"');
  cleaned = cleaned.replace(/&#39;/g, "'");
  // Remove non-visible HTML entities (zero-width, soft hyphens, etc.)
  cleaned = cleaned.replace(/&zwnj;/g, '');
  cleaned = cleaned.replace(/&zwj;/g, '');
  cleaned = cleaned.replace(/&shy;/g, '');
  cleaned = cleaned.replace(/&lrm;/g, '');
  cleaned = cleaned.replace(/&rlm;/g, '');
  // Remove numeric character references for zero-width characters
  cleaned = cleaned.replace(/&#8203;/g, ''); // zero-width space
  cleaned = cleaned.replace(/&#8204;/g, ''); // zero-width non-joiner
  cleaned = cleaned.replace(/&#8205;/g, ''); // zero-width joiner
  cleaned = cleaned.replace(/&#8206;/g, ''); // left-to-right mark
  cleaned = cleaned.replace(/&#8207;/g, ''); // right-to-left mark
  cleaned = cleaned.replace(/&#173;/g, '');  // soft hyphen
  // Remove Unicode zero-width characters directly
  cleaned = cleaned.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
  // Remove all hyperlinks (http/https URLs)
  cleaned = cleaned.replace(/https?:\/\/[^\s<]+/g, '');
  // Replace multiple consecutive newlines with a single newline
  cleaned = cleaned.replace(/\n\s*\n+/g, '\n');
  // Replace multiple spaces with a single space
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  // Trim leading/trailing whitespace
  return cleaned.trim();
}

function detectRefundCandidate(subject: string, body: string) {
  const text = (subject + '\n' + body).toLowerCase();
  const returnKeywords = ['return', 'returned', 'return label', 'return initiated', 'we received your return'];
  const refundKeywords = ['refund', 'refunded', 'refund processed', 'credited', 'we have issued a refund', 'refund has been issued', 'credit to your'];

  const isReturn = returnKeywords.some(k => text.includes(k));
  if (!isReturn) return null;

  const isRefund = refundKeywords.some(k => text.includes(k));
  // Clean the entire body first, then take first 500 characters
  const snippet = cleanSnippet(body).slice(0, 500);
  return {
    subject,
    snippet,
    status: isRefund ? 'refunded' : 'pending'
  };
}

async function fetchRefunds(periodDays: number = 14) {
  if (await getRuntimeDevMode()) {
    // simulate progress so the UI shows a determinate bar in dev mode
    const total = MOCK_REFUNDS.length;
    // Use callback and check lastError so we don't throw when no receiver is present (popup closed)
    try { chrome.runtime.sendMessage({ action: 'fetchProgress', done: 0, total }, () => { if (chrome.runtime && chrome.runtime.lastError) { /* no receiver */ } }); } catch (e) { }
    for (let i = 0; i < total; i++) {
      await new Promise((r) => setTimeout(r, 120));
      try { chrome.runtime.sendMessage({ action: 'fetchProgress', done: i + 1, total }, () => { if (chrome.runtime && chrome.runtime.lastError) { /* no receiver */ } }); } catch (e) { }
    }
    // store mock data under a period-specific cache key so popup can reload quickly
    try {
      await new Promise<void>((res) => chrome.storage.local.set({ [`refunds_${periodDays}`]: { results: MOCK_REFUNDS, fetchedAt: Date.now() } }, res));
    } catch (e) { }
    return MOCK_REFUNDS;
  }
  const token = await getToken(true);
  // Use Gmail's newer_than search operator with the number of days
  const q = encodeURIComponent(`label:important {category:primary category:updates} {subject:refund subject:"return"} -Fwd newer_than:${periodDays}d`);
  const listUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${q}`;
  const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listResp.ok) throw new Error('Failed to list messages: ' + listResp.statusText);
  const listJson = await listResp.json();
  const messages = listJson.messages || [];
  const results: any[] = [];
  const total = messages.length;
  // inform popup of total messages to scan
  try { chrome.runtime.sendMessage({ action: 'fetchProgress', done: 0, total }, () => { if (chrome.runtime && chrome.runtime.lastError) { /* no receiver */ } }); } catch (e) { }
  let processed = 0;
  for (const m of messages.slice(0, 200)) {
    const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;
    const msgResp = await fetch(msgUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!msgResp.ok) continue;
    const msgJson = await msgResp.json();
    const headers = msgJson.payload?.headers || [];
    const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === 'subject');
    const subject = (subjectHeader && subjectHeader.value) || '';
    const body = extractBody(msgJson.payload || {});
    const candidate = detectRefundCandidate(subject, body);
    if (candidate) {
      // Extract 'From' header information to group results by sender
      const fromHeader = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
      (candidate as any).from = fromHeader;
      // parse display name and email address from the From header if possible
      let fromName: string | null = null;
      let fromEmail: string | null = null;
      const angle = fromHeader.match(/^(?:\s*"?([^<\"]+)"?\s*<([^>]+)>)/);
      if (angle) {
        fromName = (angle[1] || '').trim();
        fromEmail = (angle[2] || '').trim();
      } else {
        const emailMatch = fromHeader.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          fromEmail = emailMatch[1];
        }
      }
      if (fromName) (candidate as any).fromName = fromName;
      if (fromEmail) (candidate as any).fromEmail = fromEmail;

      // Attach a date (prefer internalDate then Date header) so the UI can sort by recency
      let dateStr: string | null = null;
      if (msgJson.internalDate) {
        const ms = Number(msgJson.internalDate);
        if (!Number.isNaN(ms)) dateStr = new Date(ms).toISOString();
      }
      if (!dateStr) {
        const dateHeader = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value;
        try { if (dateHeader) dateStr = new Date(dateHeader).toISOString(); } catch (e) { dateStr = null; }
      }
      if (dateStr) (candidate as any).date = dateStr;

      // attach ids to make it possible to open thread/message later
      (candidate as any).id = m.id;
      (candidate as any).threadId = msgJson.threadId;

      results.push(candidate);
    }
    // increment processed and inform popup
    processed++;
    try { chrome.runtime.sendMessage({ action: 'fetchProgress', done: processed, total }, () => { if (chrome.runtime && chrome.runtime.lastError) { /* no receiver */ } }); } catch (e) { }
  }

  try {
    // cache results under a key per the periodDays used
    await new Promise<void>((res) => chrome.storage.local.set({ [`refunds_${periodDays}`]: { results, fetchedAt: Date.now() } }, res));
  } catch (e) { }
  return results;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.action === 'fetchRefunds') {
    const pd = (msg && typeof msg.periodDays === 'number') ? msg.periodDays : 14;
    fetchRefunds(pd)
      .then((r) => sendResponse({ ok: true, refunds: r }))
      .catch((err) => {
        let message = 'Unknown error';
        try {
          if (!err) message = 'Unknown/empty error';
          else if (typeof err === 'string') message = err;
          else if (err instanceof Error && err.message) message = err.message;
          else if ((err as any).message) message = (err as any).message;
          else message = JSON.stringify(err);
        } catch (e) {
          message = String(err);
        }
        console.error('fetchRefunds failed:', err);
        sendResponse({ ok: false, error: message });
      });
    return true; // will send response asynchronously
  }
});
