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
const COPY = process.platform === "darwin" ? "Meta+C" : "Control+C";

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
    name: "Name model: finds names the rules miss, running on-device",
    async run(page) {
      const sample = "Kowalski approved the budget, but Adaeze Okonkwo still needs to sign off.";
      await open(page, "https://chatgpt.com/");
      await pasteInto(page, "#prompt-textarea", { "text/plain": sample });
      assert.equal(await valueOf(page, "#prompt-textarea"), sample, "rules alone should not catch these names");

      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      await page.locator("#nameModel").click();
      // Turning it on first asks before the 66 MB download.
      await page.locator("#sheetPrimary", { hasText: "Download" }).click();
      await page.locator("#nameModelStatus", { hasText: "Ready" }).waitFor({ timeout: 180000 });

      try {
        await open(page, "https://chatgpt.com/");
        await pasteInto(page, "#prompt-textarea", { "text/plain": sample });
        await page.waitForFunction(() => /** @type {HTMLTextAreaElement} */ (document.querySelector("#prompt-textarea")).value !== "", null, { timeout: 20000 });
        const value = await valueOf(page, "#prompt-textarea");
        assert.ok(!value.includes("Adaeze Okonkwo"), `model should redact the name: ${value}`);
        assert.ok(value.includes("approved the budget"), `surrounding text should stay: ${value}`);
      } finally {
        await page.goto(`chrome-extension://${extensionId}/popup.html`);
        await page.locator("#nameModel").uncheck();
      }
    }
  },
  {
    name: "Popup sub-screens open in place",
    async run(page) {
      await page.setViewportSize({ width: 360, height: 560 });
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      for (const [button, view] of [["#openSites", "#sitesView"], ["#openTypes", "#typesView"]]) {
        await page.click(button);
        await page.waitForTimeout(500);
        const x = await page.locator(view).evaluate((element) => element.getBoundingClientRect().x);
        assert.equal(x, 0, `${view} is shifted by ${x}px`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  },
  {
    name: "Welcome page opens on install and its practice paste works",
    async run(page) {
      const welcome = context.pages().find((tab) => tab.url().endsWith("/welcome.html"));
      assert.ok(welcome, "the welcome page did not open on install");
      await page.goto(`chrome-extension://${extensionId}/welcome.html`);
      await page.click("#copySample");
      await page.click("#practice");
      await page.keyboard.press(PASTE);
      const practice = await page.inputValue("#practice");
      assert.ok(practice.includes("[[PERSON_1]]") && !practice.includes("Rebecca Thornton"), `not redacted: ${practice}`);
      await page.click("#copyReply");
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.ok(copied.includes("Dear Rebecca Thornton") && !copied.includes("[["), `not restored: ${copied}`);
    }
  },
  {
    name: "Copying a reply fills the real values back in",
    async run(page) {
      await open(page, "https://chatgpt.com/");
      await pasteInto(page, "#prompt-textarea", { "text/plain": SENSITIVE });
      // A reply from the AI that uses the placeholders it was sent.
      await page.evaluate(() => {
        const reply = document.createElement("div");
        reply.id = "reply";
        reply.setAttribute("data-message-author-role", "assistant");
        reply.textContent = "Dear [[PERSON_1]], we emailed [[EMAIL_1]].";
        document.body.append(reply);
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        /** @type {HTMLElement} */ (document.activeElement).blur();
        /** @type {Selection} */ (getSelection()).selectAllChildren(/** @type {HTMLElement} */ (document.getElementById("reply")));
      });
      await page.keyboard.press(COPY);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(copied, "Dear Jane Smith, we emailed jane.smith@example.com.");
      // The page itself never receives the real values.
      assert.equal(await page.locator("#reply").textContent(), "Dear [[PERSON_1]], we emailed [[EMAIL_1]].");
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
    // The name model check downloads the pinned model (66 MB) from Hugging
    // Face: Playwright cannot intercept requests made by the extension's
    // offscreen document, so it cannot be served locally. This also tests
    // the real download and its hash verification.
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
  await page.locator("#sensitivity label", { hasText: level === "strict" ? "Strict" : "Balanced" }).click();
  if (process.env.POPUP_SCREENSHOT) {
    await page.screenshot({ path: process.env.POPUP_SCREENSHOT, fullPage: true });
  }
  await page.waitForTimeout(200);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
