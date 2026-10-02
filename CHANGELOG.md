# Changelog

## 2.0.3

Rebuilt from the ground up since 1.0.2.

### Safety
- Fails closed: a paste right after page load, or when settings cannot be read, is redacted with the defaults; if redacted text cannot be inserted, the paste is blocked with a notice. 1.0.2 let such pastes through unchecked.
- Drag-and-drop, HTML-only clipboards and rich-text links that hide a token are checked.
- No input can freeze the page: every detection rule is speed-tested against adversarial input (1.0.2 took up to 6 seconds on some inputs).
- The last-redaction summary no longer stores the page address.

### Detection
- New engine with confidence levels, a Balanced/Strict setting, and no half-redacted values.
- Over 200 API key and token formats from the gitleaks rules; phone numbers checked with libphonenumber.
- Labelled fields in any format (forms, Markdown, two-column tables, "the account number is ..."), record, policy, licence and plate numbers, card-shaped numbers, US street suffixes, counties.
- Names from public first-name and surname lists, self-introductions ("I, Sabrina, ..."), middle initials, and every later mention of a found name.
- Optional on-device name model (66 MB, pinned and hash-verified, off by default, can be deleted from the settings).
- On independent public test sets, about twice as many sensitive values are caught as in 1.0.2, with fewer false alarms.

### Features
- Real values back: placeholders in replies are highlighted, hovering shows the real value, and copying a reply fills the real values back in. The same value keeps the same placeholder in a tab.
- "N hidden · Review" list by the prompt box, with Unhide for each value.
- Opt-in support for Perplexity, Mistral Le Chat, Grok and Poe.
- Welcome page with a practice paste on install.
- Redesigned settings: fixed size, explained features, flat design with WCAG AA contrast, dark mode.

### Under the hood
- Third-party licence notices, a security policy, and a stable release of the ONNX runtime instead of a pre-release build.
