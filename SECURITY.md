# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a vulnerability.

Include the SafePaste AI version (shown in the extension's menu), the browser version, the site, and steps to reproduce. Use made-up data in examples, never real personal data or secrets.

You can expect an acknowledgement within 7 days. Fixes are released through the Chrome Web Store as a new version, and the report is credited in the changelog if you wish.

## Supported versions

Only the latest version published in the Chrome Web Store receives fixes.

## Security design

- Pasted text is checked inside the browser. The extension has no server, no account and no telemetry, and makes no network request with user data.
- The only network request is optional: when the user turns on "Enhanced name detection", the name model is downloaded once from Hugging Face. It is pinned to one revision, and every file is checked against its SHA-256 before use.
- No remote code: all JavaScript and WebAssembly ship in the package. The build fails if any file contains a CDN address. The extension pages' content security policy is `script-src 'self' 'wasm-unsafe-eval'`.
- Fails closed: if a paste cannot be checked or the redacted text cannot be inserted, the paste is blocked rather than passed through.
- Real values behind placeholders are kept only in the memory of the tab where they were pasted. They are shown only inside closed shadow roots, which page scripts cannot read, and never written into the website's page.
- Stored data: settings, and a summary of the last redaction (site name, time, counts). No prompt text or original values.
- Permissions: storage, offscreen (optional name model only), scripting and activeTab (optional sites and the menu's status line), host access to ChatGPT, Gemini and Claude, and optional per-site access to Perplexity, Mistral Le Chat, Grok and Poe, requested only when the user turns a site on.

## Limits

SafePaste AI is a safety layer, not a data-loss-prevention control. It checks text that is pasted or dropped into the prompt box; it does not check typed text or file uploads, and like any detector it misses some values (about one in five in independent public test sets). The user can turn it off or unhide a value.
