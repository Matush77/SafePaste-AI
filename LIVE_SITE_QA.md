# Live Site QA Checklist

Run this checklist with the unpacked extension before every Chrome Web Store submission.

## Setup

1. Open `chrome://extensions`.
2. Load the unpacked extension from this repository.
3. Confirm the popup shows the extension enabled.
4. Use non-production sample data only.

Cloudflare and login challenges can block automated Playwright tests on these sites. For production release QA, use the assisted manual launcher:

```powershell
.\scripts\package-extension.ps1
npm run qa:live:open
```

This opens Playwright Chromium with the packaged extension loaded and keeps the browser open while you complete login, Cloudflare checks, and the checklist below.

## Sites

Test all supported sites:

- `https://chatgpt.com/`
- `https://gemini.google.com/app`
- `https://claude.ai/`

## Paste Cases

For each site, paste sample text containing:

- Person name, email, and phone number
- Multiline prompt
- Markdown code block with an API key
- Financial sample with a test credit card number
- Infrastructure sample with IP address and token
- Benign prompt that should remain unchanged

## Required Results

- Sensitive values are replaced before sending.
- Multiline formatting remains usable.
- Pasting over selected text replaces only the selection.
- Browser undo restores the previous editor state acceptably.
- Disabling the extension in the popup prevents redaction.
- Login, account, password, email, search, and other non-prompt fields are not modified.
- Popup last-redaction summary shows counts only and no prompt text.

## Release Gate

Do not submit to the Chrome Web Store unless all required results pass on all supported sites.
