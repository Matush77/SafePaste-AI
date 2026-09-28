// End-to-end check of the built extension in real Chromium, without touching
// the real AI sites: requests to chatgpt.com and claude.ai are answered with
// local fixture pages, so Chrome injects the content script exactly as it
// would in production. Uses real Ctrl+V pastes through the system clipboard.
//
//   npm run build && npm run test:e2e

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionPath = join(root, "dist", "safepaste-ai");
const PASTE = process.platform === "darwin" ? "Meta+V" : "Control+V";
const UNDO = process.platform === "darwin" ? "Meta+Z" : "Control+Z";

const SENSITIVE = "Contact Dr. Jane Smith at jane.smith@example.com, key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890.";
const REDACTED = "Contact Dr. [[PERSON_1]] at [[EMAIL_1]], key [[OPENAI_API_KEY_1]].";

const FIXTURES = {
  "https://chatgpt.com/": `<!doctype html><html><body>
    <input id="search" type="search">
    <textarea id="prompt-textarea"></textarea>
    <div id="rich" class="ProseMirror" contenteditable="true"></div>
  </body></html>`,
  "https://claude.ai/": `<!doctype html><html><body>
    <input id="email" type="email">
    <div data-testid="chat-input"><div id="rich" class="ProseMirror" contenteditable="true"></div></div>
  </body></html>`
};

/** @type {{ name: string, run: (page: import("playwright").Page) => Promise<void> }[]} */
const CASES = [
  {
    name: "ChatGPT textarea: paste is redacted",
    async run(page) {
      await open(page, "https://chatgpt.com/");
      await pasteInto(page, "#prompt-textarea", { "text/plain": SENSITIVE });
      assert.equal(await valueOf(page, "#prompt-textarea"), REDACTED);
    }
  },
  {
    name: "ChatGPT rich editor: paste is redacted and multiline text is kept",
    async run(page) {
      await open(page, "https://chatgpt.com/");
      await pasteInto(page, "#rich", { "text/plain": `line one\n${SENSITIVE}\nline three` });
      const text = await textOf(page, "#rich");
      assert.ok(text.includes(REDACTED), `redacted text missing: ${JSON.stringify(text)}`);
      assert.ok(!text.includes("jane.smith@example.com"));
      assert.equal(text.split("\n").filter(Boolean).length, 3, `line breaks lost: ${JSON.stringify(text)}`);
    }
  },
  {
    name: "Rich editor: undo removes the redacted paste",
    async run(page) {
      await open(page, "https://chatgpt.com/");
      await pasteInto(page, "#rich", { "text/plain": SENSITIVE });
      await page.keyboard.press(UNDO);
      assert.equal((await textOf(page, "#rich")).trim(), "");
    }
  },
  {
    name: "Harmless text pastes unchanged",
    async run(page) {
      await open(page, "https://chatgpt.com/");
      await pasteInto(page, "#prompt-textarea", { "text/plain": "Explain useEffect cleanup." });
      assert.equal(await valueOf(page, "#prompt-textarea"), "Explain useEffect cleanup.");
    }
  },
  {
    name: "Non-prompt inputs are never modified",
    async run(page) {
      await open(page, "https://chatgpt.com/");
      await pasteInto(page, "#search", { "text/plain": "jane.smith@example.com" });
      assert.equal(await valueOf(page, "#search"), "jane.smith@example.com");

      await open(page, "https://claude.ai/");
      await pasteInto(page, "#email", { "text/plain": "jane.smith@example.com" });
      assert.equal(await valueOf(page, "#email"), "jane.smith@example.com");
    }
  },
  {
    name: "Claude editor: link hiding a token is pasted as plain text",
    async run(page) {
      await open(page, "https://claude.ai/");
      await pasteInto(page, "#rich", {
        "text/plain": "Reset link",
        "text/html": `<a href="https://example.com/reset?token=9f8e7d6c5b4a3f2e1d">Reset link</a>`
      });
      assert.equal((await textOf(page, "#rich")).trim(), "Reset link");
      assert.equal(await page.locator("#rich a").count(), 0, "link with token was pasted");
    }
  },
  {
    name: "Popup sensitivity Strict: low-confidence matches are redacted too",
    async run(page) {
      const sample = "Batch 12-3456789 shipped on time.";
      await open(page, "https://chatgpt.com/");
      await pasteInto(page, "#prompt-textarea", { "text/plain": sample });
      assert.equal(await valueOf(page, "#prompt-textarea"), sample, "Balanced should keep it");

      await setSensitivity(page, "strict");
      try {
        await open(page, "https://chatgpt.com/");
        await pasteInto(page, "#prompt-textarea", { "text/plain": sample });
        assert.ok(!(await valueOf(page, "#prompt-textarea")).includes("12-3456789"), "Strict should redact it");
      } finally {
        await setSensitivity(page, "balanced");
      }
    }
  },
  {
    name: "Popup setting off: paste goes through unchanged",
    async run(page) {
      await setEnabled(page, false);
      try {
        await open(page, "https://chatgpt.com/");
        await pasteInto(page, "#prompt-textarea", { "text/plain": SENSITIVE });
        assert.equal(await valueOf(page, "#prompt-textarea"), SENSITIVE);
      } finally {
        await setEnabled(page, true);
      }
    }
  }
];

/** @type {import("playwright").BrowserContext} */
let context;
/** @type {string} */
let extensionId;

async function main() {
  assert.ok(existsSync(join(extensionPath, "manifest.json")), "Run npm run build first.");
  const profile = mkdtempSync(join(tmpdir(), "safepaste-e2e-"));

  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    permissions: ["clipboard-read", "clipboard-write"]
  });

  let failures = 0;
  try {
    for (const [url, html] of Object.entries(FIXTURES)) {
      await context.route(`${url}**`, (route) => route.fulfill({ contentType: "text/html", body: html }));
    }
    extensionId = await findExtensionId();

    const page = await context.newPage();
    for (const testCase of CASES) {
      try {
        await testCase.run(page);
        console.log(`  ok    ${testCase.name}`);
      } catch (error) {
        failures += 1;
        console.log(`  FAIL  ${testCase.name}\n        ${/** @type {Error} */ (error).message}`);
      }
    }
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} of ${CASES.length} end-to-end checks failed.` : `\nAll ${CASES.length} end-to-end checks passed.`);
  process.exitCode = failures ? 1 : 0;
}

// The extension has no service worker to read its ID from, so ask the
// extensions page.
async function findExtensionId() {
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
 * @param {import("playwright").Page} page
 * @param {string} url
 */
async function open(page, url) {
  await page.goto(url);
  // The content script loads settings asynchronously; give it a moment.
  await page.waitForTimeout(150);
}

/**
 * @param {import("playwright").Page} page
 * @param {string} selector
 * @param {Record<string, string>} data
 */
async function pasteInto(page, selector, data) {
  await page.evaluate(async (items) => {
    const blobs = Object.fromEntries(Object.entries(items).map(([type, value]) => [type, new Blob([value], { type })]));
    await navigator.clipboard.write([new ClipboardItem(blobs)]);
  }, data);
  await page.click(selector);
  await page.keyboard.press(PASTE);
  await page.waitForTimeout(100);
}

/**
 * @param {import("playwright").Page} page
 * @param {string} selector
 */
function valueOf(page, selector) {
  return page.locator(selector).inputValue();
}

/**
 * @param {import("playwright").Page} page
 * @param {string} selector
 */
function textOf(page, selector) {
  return page.locator(selector).evaluate((element) => /** @type {HTMLElement} */ (element).innerText);
}

/**
 * Flips the popup's Enabled switch, as a user would.
 * @param {import("playwright").Page} page
 * @param {boolean} enabled
 */
async function setEnabled(page, enabled) {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const toggle = page.locator("#enabled");
  await toggle.waitFor();
  if ((await toggle.isChecked()) !== enabled) {
    await toggle.click();
  }
  await page.waitForTimeout(200);
}

/**
 * @param {import("playwright").Page} page
 * @param {"balanced" | "strict"} level
 */
async function setSensitivity(page, level) {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator("#sensitivity").selectOption(level);
  if (process.env.POPUP_SCREENSHOT) {
    await page.screenshot({ path: process.env.POPUP_SCREENSHOT, fullPage: true });
  }
  await page.waitForTimeout(200);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
