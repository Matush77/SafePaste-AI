# Chrome Web Store Submission Checklist

## Package

- Upload `dist/safepaste-ai-1.0.2.zip`.
- Confirm `manifest.json` is at the zip root.
- Increment `version` in `manifest.json` before every resubmission with code or manifest changes.

## Listing

- Use `STORE_LISTING.md` for the name, short description, detailed description, single-purpose statement, and permission justifications.
- Add Chrome Web Store screenshots and promotional images in the Developer Dashboard.
- Choose the most appropriate category and distribution visibility.

## Privacy

- Use `PRIVACY.md` as the privacy policy source.
- In the Privacy practices tab, disclose that pasted text is processed locally and not transmitted.
- Confirm that the extension does not sell, transfer, or remotely process user data.
- Confirm that the extension stores only settings and redaction-count summaries, not prompt text.

## Final QA

```powershell
node tests/redactor-smoke.js
node tests/redactor-scenarios.js
node tests/contact-block.js
node tests/site-adapters.js
node tests/content-script-runtime.js
.\scripts\package-extension.ps1
npm run qa:live:open
```

## Live Site QA

- Complete `LIVE_SITE_QA.md` on each supported AI chat website.
- If Cloudflare blocks automation, complete the browser challenge manually in the Playwright-opened Chrome window.
- Do not submit until all required live-site results pass.
