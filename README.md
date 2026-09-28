# SafePaste AI

Chrome MV3 extension that redacts sensitive data locally when you paste or drop text into:

- `https://chatgpt.com/`
- `https://gemini.google.com/app`
- `https://claude.ai/`

Detection runs entirely in the browser. The extension makes no network requests and does not store original sensitive values or prompt text.

SafePaste AI is independent and is not affiliated with the third-party AI chat services it supports.

## What it does

When you paste or drop text into a supported prompt editor, the extension scans it and inserts a copy with sensitive values replaced by placeholders such as `[[EMAIL_1]]` or `[[PERSON_1]]`. Repeated values in the same paste get the same placeholder.

It detects API keys and tokens, credentials, email addresses, phone numbers, government IDs, card numbers and IBANs, IP and MAC addresses, street addresses, people, organisations and locations. URLs are optional.

Safety behaviour:

- Redaction is on from the first moment the page loads. A paste before settings load, or a failure to read settings, is still redacted.
- If the redacted text cannot be inserted, the paste is blocked and a notice says so. The original never falls through.
- Rich-text pastes whose links or attributes hide a sensitive value (for example a reset link carrying a token) are pasted as plain text.
- Login, email, search and other non-prompt fields are never touched.

This is a heuristic safety layer, not a compliance boundary. Current quality is measured by `npm run eval`, described below.

## Development

Requires Node 20 or newer.

```bash
npm ci
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/safepaste-ai`. Run `npm run watch` to rebuild on every change to `src/`, then reload the extension.

### Layout

| Path | Contents |
|---|---|
| `src/redactor.js` | Detection and redaction. Pure functions, no browser APIs. |
| `src/siteAdapters.js` | Supported sites, prompt-editor detection, text insertion. |
| `src/pasteGuard.js` | Paste and drop interception, fail-closed behaviour. |
| `src/contentScript.js` | Content-script entry point. |
| `src/popup/popup.js` | Settings popup. |
| `static/` | Manifest, popup HTML/CSS, privacy page, icons. Copied into the build as-is. |
| `scripts/build.js` | Bundles `src/` with esbuild and validates and zips the package. |
| `tests/unit/` | Unit tests (Vitest, with jsdom for DOM code). |
| `tests/eval/` | Labelled evaluation corpus, scorer and quality baseline. |
| `tests/fixtures/legacy/` | Benchmarks from before the evaluation corpus, kept as leak-regression checks. |
| `tests/e2e/` | Loads the built extension in Chromium against local copies of the site editors. |
| `tests/live/` | Manual QA against the real sites with your own logins. |
| `tests/harness/` | Manual paste harness page. |

### Commands

| Command | What it does |
|---|---|
| `npm run build` | Build the unpacked extension into `dist/safepaste-ai`. |
| `npm run watch` | Rebuild on change. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | Type-check `src/` from its JSDoc types (TypeScript in `checkJs` mode). |
| `npm test` | Unit tests, legacy leak checks, and the redaction quality gate. |
| `npm run test:e2e` | Real-browser test of the built extension. Run `npm run build` first. |
| `npm run eval` | Print redaction quality: recall, precision, and false positives per category. Add `-- --verbose` to list every miss and false positive. |
| `npm run eval:update-baseline` | Accept the current quality scores as the new baseline. |
| `npm run check` | Everything above, as CI runs it. |
| `npm run build:zip` | Build and write `dist/safepaste-ai-<version>.zip` for the Chrome Web Store. |

## Measuring redaction quality

`tests/eval/corpus/` holds realistic prompts. Every sensitive value in them is labelled, and there is a separate set of harmless code, logs and prose that should come through unchanged. Labelling rules are in [tests/eval/GUIDELINES.md](tests/eval/GUIDELINES.md).

`npm run eval` reports:

- **Recall:** the share of labelled values that were fully redacted. Redacting half a token counts as a leak.
- **Precision:** the share of redactions that hit something sensitive. False positives break code and prose and push users to turn the extension off.
- **Benign samples unchanged:** the share of harmless samples pasted with no changes at all.

`tests/eval/baseline.json` stores the accepted scores, and `npm test` fails if any of them gets worse. When a change improves the scores, run `npm run eval:update-baseline` and commit the new baseline with the change. Never edit the corpus labels to make a score go up.

## Release

1. Raise `version` in `static/manifest.json`. It is the only place the version is set.
2. Run `npm run check`.
3. Run `npm run build:zip`. It refuses to overwrite an existing zip for the same version.
4. Complete [LIVE_SITE_QA.md](LIVE_SITE_QA.md) against the real sites.
5. Follow [CHROME_STORE_CHECKLIST.md](CHROME_STORE_CHECKLIST.md).
