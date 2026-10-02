// Automated part of LIVE_SITE_QA.md: runs the built extension against the real
// ChatGPT, Gemini and Claude prompt editors using your logged-in QA profile.
// It only pastes fake sample data and clears it again; it never sends a message.
//
//   npm run build && npm run test:live
//   LIVE_QA_SITES=claude npm run test:live     # one site only
//
// If a site shows a login or Cloudflare check, complete it in the opened
// window (or use npm run qa:live:open) and rerun.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionPath = path.join(root, "dist", "safepaste-ai");
// Kept outside the repository: it holds real logins to the AI sites.
const profileDir = process.env.SAFEPASTE_QA_PROFILE || path.join(os.homedir(), ".safepaste-ai", "playwright-profile");
const outputDir = path.join(root, "test-results", "live-playwright");
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const CONTACT_SAMPLE = [
  "Do not send this. This is a redaction QA paste.",
  "Contact Dr. Jane Smith at jane.smith@example.com or +1 415-555-0199.",
  "Use test card 4111 1111 1111 1111 and token sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890.",
  "906 W 2ND AVE, STE 100",
  "SPOKANE, WA 99201-4540, United States"
].join("\n");

const SITES = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    editorSelectors: [
      "#prompt-textarea",
      "div.ProseMirror[contenteditable='true']",
      "[contenteditable='true'][aria-label*='message' i]"
    ]
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    editorSelectors: [
      "rich-textarea [contenteditable='true']",
      "div.ql-editor[contenteditable='true']",
      "[contenteditable='true'][aria-label*='prompt' i]"
    ]
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/new",
    editorSelectors: [
      "[data-testid='chat-input'] [contenteditable='true']",
      "div.ProseMirror[contenteditable='true']",
      "[contenteditable='true'][aria-label*='prompt' i]"
    ]
  }
];

/**
 * @typedef {import("playwright").Page} Page
 * @typedef {import("playwright").Locator} Locator
 * @typedef {{ page: Page, editor: Locator }} Ctx
 * @typedef {{ name: string, known?: string, run: (ctx: Ctx) => Promise<void> }} Check
 */

/** @type {Check[]} */
const CHECKS = [
  {
    name: "Contact, card and API key are redacted",
    async run({ page, editor }) {
      const text = await pasteAndRead(page, editor, CONTACT_SAMPLE);
      for (const placeholder of ["PERSON_1", "EMAIL_1", "PHONE_1", "CREDIT_CARD_1", "OPENAI_API_KEY_1", "ADDRESS_1"]) {
        assert.ok(text.includes(`[[${placeholder}]]`), `missing [[${placeholder}]]`);
      }
      assertNoLeak(text, ["Jane Smith", "jane.smith@example.com", "415-555-0199", "4111 1111 1111 1111", "sk-proj-AbCd", "906 W 2ND AVE", "SPOKANE, WA 99201"]);
    }
  },
  {
    name: "Multiline formatting is kept",
    async run({ page, editor }) {
      const text = await pasteAndRead(page, editor, "first line\nmail jane.smith@example.com\nthird line");
      const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
      assert.deepEqual(lines, ["first line", "mail [[EMAIL_1]]", "third line"]);
    }
  },
  {
    name: "Code block with an API key",
    async run({ page, editor }) {
      const text = await pasteAndRead(page, editor, "```bash\nexport GITHUB_TOKEN=ghp_R4nD0mT0k3nV4lu3F0rT3st1ngPurp0s3s12\nnpm publish\n```");
      assertNoLeak(text, ["ghp_R4nD0m"]);
      assert.ok(text.includes("npm publish"), "surrounding code was lost");
    }
  },
  {
    name: "Infrastructure log with IP and token",
    async run({ page, editor }) {
      const text = await pasteAndRead(page, editor, "10.12.4.31 GET /health 200\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
      assertNoLeak(text, ["10.12.4.31", "eyJhbGciOiJIUzI1NiJ9"]);
    }
  },
  {
    name: "JSON config with a password field",
    async run({ page, editor }) {
      const text = await pasteAndRead(page, editor, "{\n  \"user\": \"app_rw\",\n  \"password\": \"hunter2-Prod!\"\n}");
      assertNoLeak(text, ["hunter2-Prod!"]);
    }
  },
  {
    name: "Harmless prompt is pasted unchanged",
    async run({ page, editor }) {
      const text = await pasteAndRead(page, editor, "Explain how to debounce a text input in React.");
      assert.equal(text.trim(), "Explain how to debounce a text input in React.");
    }
  },
  {
    name: "Pasting over a selection replaces only the selection",
    async run({ page, editor }) {
      await clearEditor(page, editor);
      await page.keyboard.type("keep this REPLACE_ME end");
      await selectWord(editor, "REPLACE_ME");
      const text = await pasteAndRead(page, editor, "jane.smith@example.com", { clear: false });
      assert.equal(text.trim(), "keep this [[EMAIL_1]] end");
    }
  },
  {
    name: "Undo removes the redacted paste",
    async run({ page, editor }) {
      await clearEditor(page, editor);
      // Rich editors (Quill, ProseMirror) merge edits made within about a
      // second into one undo step; wait so undo only reverts the paste.
      await page.waitForTimeout(1500);
      await pasteAndRead(page, editor, "mail jane.smith@example.com", { clear: false });
      await page.keyboard.press(`${MOD}+Z`);
      await page.waitForTimeout(300);
      const text = await readEditor(editor);
      assert.ok(!text.includes("[[EMAIL_1]]"), `undo left: ${JSON.stringify(text)}`);
      assertNoLeak(text, ["jane.smith@example.com"]);
    }
  }
];

const requestedSites = new Set(
  (process.env.LIVE_QA_SITES || "").split(",").map((site) => site.trim().toLowerCase()).filter(Boolean)
);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  assert.equal(fs.existsSync(path.join(extensionPath, "manifest.json")), true, "Run npm run build before live QA");
  validatePackageInputs();

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check"
    ],
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1440, height: 1000 }
  });

  /** @type {{ site: string, check: string, status: string, detail: string }[]} */
  const results = [];
  try {
    await serveModelFromCache(context);
    const extensionId = await findExtensionId(context);
    for (const site of selectedSites()) {
      const page = await context.newPage();
      try {
        await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        const editor = await findEditor(page, site.editorSelectors, 90000);
        if (!editor) {
          results.push({ site: site.name, check: "open prompt editor", status: "blocked", detail: "Prompt editor not found: log in or pass the Cloudflare check in the opened window, then rerun." });
          continue;
        }

        for (const check of CHECKS) {
          results.push(await runCheck(site.name, check, { page, editor }));
        }
        results.push(await runCheck(site.name, {
          name: "Name model: names without cues are redacted (delayed insert)",
          async run(ctx) {
            await setNameModel(context, extensionId, true);
            try {
              await ctx.page.bringToFront();
              await ctx.page.waitForTimeout(1500);
              const text = await pasteAndRead(ctx.page, ctx.editor, "Kowalski approved the budget, but Adaeze Okonkwo still needs to sign off.");
              await ctx.page.waitForTimeout(2000);
              const final = await readEditor(ctx.editor);
              assertNoLeak(final, ["Adaeze Okonkwo"]);
              assert.ok(final.includes("approved the budget"), `text lost: ${JSON.stringify(final || text)}`);
              assert.equal((final.match(/approved the budget/g) || []).length, 1, `inserted twice: ${JSON.stringify(final)}`);
            } finally {
              await setNameModel(context, extensionId, false);
              await ctx.page.bringToFront();
            }
          }
        }, { page, editor }));
        results.push(await runCheck(site.name, {
          name: "Turning the extension off in the popup stops redaction",
          async run(ctx) {
            await setEnabled(context, extensionId, false);
            try {
              await ctx.page.bringToFront();
              const text = await pasteAndRead(ctx.page, ctx.editor, "mail jane.smith@example.com");
              assert.ok(text.includes("jane.smith@example.com"), `still redacted: ${JSON.stringify(text)}`);
            } finally {
              await setEnabled(context, extensionId, true);
              await ctx.page.bringToFront();
            }
          }
        }, { page, editor }));

        await clearEditor(page, editor).catch(() => {});
        await page.screenshot({ path: path.join(outputDir, `${site.id}.png`) }).catch(() => {});
      } catch (error) {
        results.push({ site: site.name, check: "run", status: "blocked", detail: /** @type {Error} */ (error).message.split("\n")[0] });
      } finally {
        if (!page.isClosed()) {
          await clearAnyEditor(page, site.editorSelectors);
          await page.close();
        }
      }
    }
  } finally {
    await context.close();
  }

  const reportPath = path.join(outputDir, "results.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.table(results);

  const failed = results.filter((result) => result.status === "failed" || result.status === "blocked");
  if (failed.length) {
    process.exitCode = 1;
    console.log(`\n${failed.length} check(s) failed or were blocked. Details: ${reportPath}`);
  } else {
    console.log(`\nAll live checks passed (known gaps are listed as "known"). Details: ${reportPath}`);
  }
}

/**
 * @param {string} siteName
 * @param {Check} check
 * @param {Ctx} ctx
 */
async function runCheck(siteName, check, ctx) {
  try {
    await check.run(ctx);
    return { site: siteName, check: check.name, status: check.known ? "fixed?" : "passed", detail: check.known ? `expected to fail (${check.known}) but passed` : "" };
  } catch (error) {
    const message = /** @type {Error} */ (error).message.split("\n")[0];
    return { site: siteName, check: check.name, status: check.known ? "known" : "failed", detail: check.known ? `${check.known}: ${message}` : message };
  }
}

function selectedSites() {
  return requestedSites.size === 0
    ? SITES
    : SITES.filter((site) => requestedSites.has(site.id) || requestedSites.has(site.name.toLowerCase()));
}

/**
 * @param {Page} page
 * @param {string[]} selectors
 * @param {number} timeoutMs
 * @returns {Promise<Locator | null>}
 */
async function findEditor(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !page.isClosed()) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count().catch(() => 0)) && (await locator.isVisible().catch(() => false))) {
        return locator;
      }
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

/**
 * Real Ctrl+V paste through the system clipboard, then returns the editor text.
 * @param {Page} page
 * @param {Locator} editor
 * @param {string} text
 * @param {{ clear?: boolean }} [options]
 */
async function pasteAndRead(page, editor, text, { clear = true } = {}) {
  if (clear) {
    await clearEditor(page, editor);
  }
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await editor.focus();
  await page.keyboard.press(`${MOD}+V`);
  await page.waitForTimeout(700);
  return readEditor(editor);
}

/**
 * @param {Page} page
 * @param {Locator} editor
 */
async function clearEditor(page, editor) {
  await editor.click({ timeout: 10000 });
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
}

/**
 * Leaves no QA text behind in the real site's draft.
 * @param {Page} page
 * @param {string[]} selectors
 */
async function clearAnyEditor(page, selectors) {
  const editor = await findEditor(page, selectors, 1000).catch(() => null);
  if (editor) {
    await clearEditor(page, editor).catch(() => {});
  }
}

/** @param {Locator} editor */
function readEditor(editor) {
  return editor.evaluate((element) => ("value" in element ? String(element.value) : /** @type {HTMLElement} */ (element).innerText || ""));
}

/**
 * @param {Locator} editor
 * @param {string} word
 */
async function selectWord(editor, word) {
  await editor.evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = (node.nodeValue || "").indexOf(target);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + target.length);
        const selection = /** @type {Selection} */ (document.getSelection());
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }
    throw new Error(`"${target}" not found in editor`);
  }, word);
}

/**
 * @param {string} text
 * @param {string[]} originals
 */
function assertNoLeak(text, originals) {
  const leaked = originals.filter((value) => text.includes(value));
  assert.deepEqual(leaked, [], `leaked ${leaked.join(", ")}`);
}

/** @param {import("playwright").BrowserContext} context */
async function findExtensionId(context) {
  const page = await context.newPage();
  await page.goto("chrome://extensions");
  const id = await page.evaluate(async () => {
    // @ts-ignore chrome.developerPrivate exists on chrome://extensions
    const items = await chrome.developerPrivate.getExtensionsInfo();
    return items.find((/** @type {{ name: string }} */ item) => item.name === "SafePaste AI")?.id;
  });
  await page.close();
  assert.ok(id, "SafePaste AI is not loaded");
  return id;
}

/**
 * Flips the popup's Enabled switch, as a user would.
 * @param {import("playwright").BrowserContext} context
 * @param {string} extensionId
 * @param {boolean} enabled
 */
async function setEnabled(context, extensionId, enabled) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const toggle = popup.locator("#enabled");
  await toggle.waitFor();
  if ((await toggle.isChecked()) !== enabled) {
    await toggle.click();
  }
  await popup.waitForTimeout(300);
  await popup.close();
}

/**
 * Turns the optional name model on or off in the popup and, when turning it
 * on, waits until it is loaded.
 * @param {import("playwright").BrowserContext} context
 * @param {string} extensionId
 * @param {boolean} on
 */
async function setNameModel(context, extensionId, on) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const toggle = popup.locator("#nameModel");
  await toggle.waitFor();
  if ((await toggle.isChecked()) !== on) {
    await toggle.click();
    // Turning it on asks before downloading, unless it is already downloaded.
    const download = popup.locator("#sheetPrimary", { hasText: "Download" });
    if (on && (await download.isVisible())) {
      await download.click();
    }
  }
  if (on) {
    await popup.locator("#nameModelStatus", { hasText: "Ready" }).waitFor({ timeout: 300000 });
  }
  await popup.close();
}

// Serve the name model from the local transformers.js cache (filled by
// `npm run eval:ner`) instead of downloading 66 MB from Hugging Face.
const MODEL_CACHE = path.join(root, "node_modules", "@huggingface", "transformers", ".cache");

/** @param {import("playwright").BrowserContext} context */
async function serveModelFromCache(context) {
  await context.route("https://huggingface.co/**", (route) => {
    const match = /\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/.exec(new URL(route.request().url()).pathname);
    const cached = match && path.join(MODEL_CACHE, match[1], match[2]);
    if (cached && fs.existsSync(cached)) {
      return route.fulfill({ path: cached, headers: { "access-control-allow-origin": "*" } });
    }
    return route.continue();
  });
}

function validatePackageInputs() {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8"));
  assert.equal(manifest.permissions.includes("clipboardWrite"), false, "clipboardWrite must not be present");
  assert.equal(Boolean(manifest.content_scripts && manifest.content_scripts.length), true, "content script required");
}
