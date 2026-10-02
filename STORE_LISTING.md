# Chrome Web Store Listing Draft

## Name

SafePaste AI

## Short Description

Redacts sensitive data locally before pasted text reaches supported AI chat websites.

## Detailed Description

SafePaste AI helps reduce accidental disclosure when copying text into supported AI chat websites. When you paste or drop text into a supported prompt box, the extension scans the pasted text locally in your browser and replaces detected sensitive values with typed placeholders such as `[[EMAIL_1]]`, `[[PHONE_1]]`, or `[[PERSON_1]]`.

It uses local detection rules for common sensitive data: API keys and tokens (including the gitleaks rule set for more than 200 providers), passwords and credentials, emails, phone numbers, government IDs, credit cards, IBANs, IP and MAC addresses, street addresses, names, organizations and locations. If a paste cannot be checked, it is blocked instead of going through unredacted. Links that hide a token in pasted rich text are pasted as plain text.

Get your real values back: hover a placeholder in the AI's reply to see what it stands for, and copy a reply to get it with the real names, emails and numbers filled back in, ready to send. A small "hidden" chip by the prompt box lists what was hidden and lets you unhide any item before sending. The real values stay in that browser tab only and are never shown to the website.

Optional enhanced name detection finds names the rules miss with a small AI model that runs entirely on your device (off by default; turning it on downloads the model once).

SafePaste AI is a safety layer, not a compliance guarantee.

The extension does not send pasted content to an external service and does not use remote AI APIs. Original sensitive values are not stored.

SafePaste AI is independent and is not affiliated with the third-party AI chat services it supports.

## Permission Justification

`storage`: Saves user settings and a local last-redaction summary with counts only. Prompt text and original sensitive values are not stored.

Host access for the supported AI chat websites: Required so the content script can intercept paste and drop events and insert redacted text inside those prompt editors.

`offscreen`: Used only when the user turns on the optional "Enhanced name detection". Runs the on-device name-detection model in an offscreen document, because the WebAssembly runtime it needs cannot run in the service worker. Pasted text is processed on the device and not transmitted.

Content security policy `wasm-unsafe-eval` for extension pages: Needed to run the packaged WebAssembly runtime of the optional on-device name model. No remote code is loaded.

## Single Purpose

The extension only redacts sensitive content from text pasted or dropped into supported AI chat websites.

## Privacy Practices Summary

- Does not sell or transfer user data.
- Does not transmit pasted text to servers.
- Does not use remote code.
- Optional, off by default: downloads a name-detection model (about 66 MB) from Hugging Face once when the user enables it. The download contains no user data.
- Stores settings and redaction-count summaries locally.
