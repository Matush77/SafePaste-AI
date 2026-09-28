# Chrome Web Store Submission Checklist

## Package

- Raise `version` in `static/manifest.json` before every resubmission with code or manifest changes.
- Run `npm run check`. Lint, type checks, unit tests, the redaction quality gate and the end-to-end browser test must all pass.
- Run `npm run build:zip` and upload `dist/safepaste-ai-<version>.zip`. `manifest.json` is at the zip root.

## Listing

- Use `STORE_LISTING.md` for the name, short description, detailed description, single-purpose statement, and permission justifications.
- Add Chrome Web Store screenshots and promotional images from `store-assets/` in the Developer Dashboard.
- Choose the most appropriate category and distribution visibility.

## Privacy

- Use `PRIVACY.md` as the privacy policy source; `static/privacy.html` is the hosted version.
- In the Privacy practices tab, disclose that pasted text is processed locally and not transmitted.
- Confirm that the extension does not sell, transfer, or remotely process user data.
- Confirm that the extension stores only settings and redaction-count summaries, not prompt text.

## Live Site QA

- Complete `LIVE_SITE_QA.md` on each supported AI chat website.
- If Cloudflare blocks automation, complete the browser challenge manually in the Playwright-opened Chrome window.
- Do not submit until all required live-site results pass.
