# Chrome Web Store Listing Draft

## Name

SafePaste AI

## Short Description

Redacts sensitive data locally before pasted text reaches supported AI chat websites.

## Detailed Description

SafePaste AI helps reduce accidental disclosure when copying text into supported AI chat websites. When you paste into a supported prompt box, the extension scans the pasted text locally in your browser and replaces detected sensitive values with typed placeholders such as `[[EMAIL_1]]`, `[[PERSON_1]]`, or `[[API_KEY_1]]`.

It uses local heuristic detection for common sensitive patterns including API keys, tokens, credentials, emails, phone numbers, government IDs, credit cards, IBANs, IP addresses, MAC addresses, street addresses, organization names, locations, and lightweight person-name matches. It is a safety layer, not a compliance guarantee.

The extension does not send pasted content to an external service and does not use remote AI APIs. Original sensitive values are not stored.

SafePaste AI is independent and is not affiliated with the third-party AI chat services it supports.

## Permission Justification

`storage`: Saves user settings and a local last-redaction summary with counts only. Prompt text and original sensitive values are not stored.

Host access for the supported AI chat websites: Required so the content script can intercept paste events and insert redacted text inside those prompt editors.

## Single Purpose

The extension only redacts sensitive content from text pasted into supported AI chat websites.

## Privacy Practices Summary

- Does not sell or transfer user data.
- Does not transmit pasted text to servers.
- Does not use remote code.
- Stores settings and redaction-count summaries locally.
