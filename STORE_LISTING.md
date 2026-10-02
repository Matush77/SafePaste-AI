# Chrome Web Store Listing

Copy each section into the matching field of the Chrome Web Store Developer Dashboard.

## Name

SafePaste AI

## Short Description (132 characters max)

Hides names, emails, card numbers and API keys before your paste reaches ChatGPT, Gemini or Claude. Runs on your computer.

## Detailed Description

Paste into AI chats without giving away personal data or secrets.

SafePaste AI checks text the moment you paste or drop it into ChatGPT, Gemini or Claude, and replaces sensitive values with placeholders such as [[PERSON_1]], [[EMAIL_1]] or [[CREDIT_CARD_1]] before the AI sees them. Everything happens inside your browser: no account, no servers, no tracking.

WHAT IT HIDES
• Names, companies, street addresses and places
• Email addresses and phone numbers
• Card numbers, IBANs, bank, routing and account numbers
• Social Security, ID, medical record, policy, licence and plate numbers
• API keys and tokens (over 200 formats from the open-source gitleaks rules), passwords and connection strings
• IP and MAC addresses

GET YOUR REAL VALUES BACK
• Hover a placeholder in the AI's reply to see what it stands for.
• Copy the reply and the real names, emails and numbers are filled back in, ready to send.
• The same value keeps the same placeholder for the whole conversation, so the AI can still reason about "the same customer".
• Real values stay in that browser tab only and are never written into the website.

ALWAYS IN CONTROL
• A small "hidden · Review" list by the prompt box shows what was hidden; Unhide puts any value back before you send.
• Balanced or Strict protection, and a switch for each kind of data.
• If a paste cannot be checked, it is blocked rather than sent unchecked. Links that hide a token in rich text are pasted as plain text.

WORKS ON
ChatGPT, Gemini and Claude, plus Perplexity, Mistral Le Chat, Grok and Poe, which you can switch on with one click.

OPTIONAL: ENHANCED NAME DETECTION
A small AI model (about 66 MB, downloaded once from Hugging Face and stored inside Chrome) finds names the built-in rules miss. It runs on your computer, is off by default, and can be deleted from the settings.

SafePaste AI is a safety layer, not a compliance guarantee. It is independent and not affiliated with OpenAI, Google, Anthropic, Perplexity, Mistral AI, xAI or Quora.

## Category

Productivity (or Privacy & Security, if offered)

## Permission Justifications

`storage`: Saves the user's settings and a local summary of the last redaction (site name, time, counts only). Prompt text and original sensitive values are never stored.

`offscreen`: Used only when the user turns on the optional "Enhanced name detection". Runs the on-device name model in an offscreen document, because its WebAssembly runtime cannot run in the service worker. Pasted text is processed on the device and not transmitted.

`scripting`: Registers SafePaste's content script on the optional AI chat sites (Perplexity, Mistral Le Chat, Grok, Poe) only after the user allows each site, and adds it to tabs already open on that site, so protection starts without a reload.

`activeTab`: When the user opens the SafePaste menu, it reads the current tab's address only to show whether that tab is protected, or to suggest switching SafePaste on for an optional AI chat site.

Host permissions (chatgpt.com, gemini.google.com, claude.ai): The content script intercepts paste and drop events in these sites' prompt boxes and inserts the redacted text. It does not read anything else on the page.

Optional host permissions (perplexity.ai, chat.mistral.ai, grok.com, poe.com): Requested only when the user switches SafePaste on for that site, for the same paste and drop protection.

Content security policy `wasm-unsafe-eval` for extension pages: Needed to run the packaged WebAssembly runtime of the optional on-device name model. No remote code is loaded.

## Single Purpose

Redacts sensitive data from text pasted or dropped into AI chat websites, before the website receives it.

## Remote Code

No. All JavaScript and WebAssembly ships in the package. The optional model download contains model weights (data), not code.

## Data Usage (Privacy practices tab)

- Data collected: none. Leave every data type unticked: pasted text is processed in the browser and never collected or transmitted.
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## Privacy Policy URL

The public URL where `PRIVACY.md` (or `static/privacy.html`) is hosted. Update the hosted copy before submitting: it now covers the in-tab memory for real values, optional sites and the optional model.
