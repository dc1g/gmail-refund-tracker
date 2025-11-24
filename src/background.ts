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

function detectRefundCandidate(subject: string, body: string) {
  const text = (subject + '\n' + body).toLowerCase();
  const returnKeywords = ['return', 'returned', 'return label', 'return initiated', 'we received your return'];
  const refundKeywords = ['refund', 'refunded', 'refund processed', 'credited', 'we have issued a refund', 'refund has been issued', 'credit to your'];

  const isReturn = returnKeywords.some(k => text.includes(k));
  if (!isReturn) return null;

  const isRefund = refundKeywords.some(k => text.includes(k));
  return {
    subject,
    snippet: body.slice(0, 500),
    status: isRefund ? 'refunded' : 'pending'
  };
}

async function fetchRefunds() {
  if (await getRuntimeDevMode()) {
    await new Promise<void>((res) => chrome.storage.local.set({ refunds: MOCK_REFUNDS }, res));
    return MOCK_REFUNDS;
  }
  const token = await getToken(true);
  const q = encodeURIComponent("refund OR return OR refunded OR 'refund processed'");
  const listUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${q}`;
  const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listResp.ok) throw new Error('Failed to list messages: ' + listResp.statusText);
  const listJson = await listResp.json();
  const messages = listJson.messages || [];

  const results: any[] = [];
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
    if (candidate) results.push(candidate);
  }

  await new Promise<void>((res) => chrome.storage.local.set({ refunds: results }, res));
  return results;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.action === 'fetchRefunds') {
    fetchRefunds()
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
