# SafePaste AI

Chrome MV3 extension that automatically redacts sensitive data when pasting into:

- `https://chatgpt.com/`
- `https://gemini.google.com/app`
- `https://claude.ai/`

The extension runs locally in the browser. It does not call external APIs and does not store original sensitive values or redacted prompt text.

SafePaste AI is independent and is not affiliated with the third-party AI chat services it supports.

## What It Redacts

- API keys, tokens, JWTs, private keys, and common secret assignments
- Email addresses
- Phone numbers
- SSNs and similar government IDs
- Credit cards with Luhn validation and IBANs
- IP and MAC addresses
- Street addresses
- Lightweight NER-style matches for people, organizations, and locations
- URLs when enabled in the popup

Repeated values in the same paste receive stable placeholders such as `[[EMAIL_1]]` or `[[PERSON_1]]`.

When redaction happens, the extension can show a short on-page confirmation with only the number of redacted items. This notice does not include prompt text or sensitive values and can be disabled in the popup.

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the unpacked extension folder.
5. Paste text into a supported AI chat editor. Sensitive data is replaced before the page receives it.

## Smoke Test

Run the local redaction-engine sanity check:

```powershell
node tests/redactor-smoke.js
node tests/redactor-scenarios.js
node tests/contact-block.js
node tests/site-adapters.js
node tests/content-script-runtime.js
```

## Live Playwright QA

The live QA runner opens Playwright Chromium with the unpacked extension loaded and tests the real prompt editors without submitting messages:

```powershell
npm run test:live
```

If any site shows a login screen, sign in in the opened Chrome window and rerun the command.

If Cloudflare blocks automation, use the assisted manual launcher instead:

```powershell
.\scripts\package-extension.ps1
npm run qa:live:open
```

Then complete [LIVE_SITE_QA.md](LIVE_SITE_QA.md) in the opened Playwright Chromium window.

## Package For Chrome Web Store

Run the packaging script from this folder:

```powershell
.\scripts\package-extension.ps1
```

Upload the generated zip from `dist\safepaste-ai-1.0.2.zip` to the Chrome Web Store Developer Dashboard.

Before submitting, use [STORE_LISTING.md](STORE_LISTING.md) for the listing copy and permission justifications, host [privacy.html](privacy.html) as the public privacy policy page, and complete [LIVE_SITE_QA.md](LIVE_SITE_QA.md).

## Browser Paste Harness

For interactive paste testing, serve the repository and open the harness:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/tests/paste-harness.html`.

The harness includes 20 English prompt cases covering credentials, customer PII, finance, infrastructure logs, healthcare notes, HR documents, travel records, API tokens, banking data, legal records, vendor contracts, and benign technical text. Select a case, copy it, paste into the editor, and confirm the page reports `PASS`.

## Notes

This is a local heuristic redactor. It is useful as a safety layer, but it should not be treated as a compliance boundary. Review important prompts before sending them.
