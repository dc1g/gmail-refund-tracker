# Gmail Refund Tracker

Chrome extension (MV3) written in TypeScript to find emails about returns/refunds and highlight pending refunds.

Setup

1. Install dependencies and build:

```bash
cd gmail-refund-tracker
npm install
npm run build
```

2. Google OAuth setup (required for Gmail API access):

- Go to https://console.developers.google.com and create a new project.
- Enable the Gmail API for the project.
- Create OAuth credentials: choose "OAuth Client ID" and set Application type to "Chrome App" or "Web application". For extensions, you will typically use an OAuth client where you add an authorized redirect URI of the form:

```
https://<YOUR_EXTENSION_ID>.chromiumapp.org/
```

- Copy the `client_id` and replace the placeholder `YOUR_CLIENT_ID.apps.googleusercontent.com` in `manifest.json`.

3. Load unpacked extension:

- Open `chrome://extensions/` in Chrome (or Edge), enable Developer Mode, click "Load unpacked", and select this repository root. (Make sure `dist/` contains the built `background.js` and `popup.js`.)

Notes

- The extension uses `chrome.identity.getAuthToken` to obtain an OAuth token. The manifest contains an `oauth2.client_id` placeholder — replace it with your client ID.
- This is an initial scaffold; the parser is heuristic-based and will need refinement for false positives/negatives.
- The extension only requests read-only Gmail scopes.

Dev / Mock mode

- For faster development you can use the built-in dev/mock mode. Open `src/config.ts` and set `DEV_MODE = true` to use a small sample dataset instead of contacting Gmail. When enabled the popup shows a `DEV` badge and `fetchRefunds` returns the mock data.
- Remember to set `DEV_MODE = false` before publishing or when you want to test the real OAuth flow.
# gmail-refund-tracker
gmail plugin to track online purchases and refunds
