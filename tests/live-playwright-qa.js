const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const extensionPath = path.join(root, "dist", "safepaste-ai");
const profileDir = path.join(root, ".playwright-live-profile");
const outputDir = path.join(root, "test-results", "live-playwright");

const SAMPLE = [
  "Do not send this. This is a redaction QA paste.",
  "Contact Dr. Jane Smith at jane.smith@example.com or +1 415-555-0199.",
  "Use test card 4111 1111 1111 1111 and token sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890.",
  "Address Icon",
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
      "textarea[data-id='root']",
      "div.ProseMirror[contenteditable='true']",
      "[contenteditable='true'][aria-label*='message' i]",
      "[contenteditable='true'][data-placeholder*='message' i]"
    ]
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    editorSelectors: [
      "rich-textarea [contenteditable='true']",
      "rich-textarea textarea",
      "div.ql-editor[contenteditable='true']",
      "[contenteditable='true'][aria-label*='prompt' i]",
      "[contenteditable='true'][aria-label*='message' i]"
    ]
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/",
    editorSelectors: [
      "div.ProseMirror[contenteditable='true']",
      "[contenteditable='true'][aria-label*='message' i]",
      "[contenteditable='true'][aria-label*='prompt' i]",
      "[contenteditable='true'][data-placeholder*='reply' i]"
    ]
  }
];

const requestedSites = new Set(
  (process.env.LIVE_QA_SITES || "")
    .split(",")
    .map((site) => site.trim().toLowerCase())
    .filter(Boolean)
);

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  validatePackageInputs();
  assert.equal(fs.existsSync(path.join(extensionPath, "manifest.json")), true, "Run .\\scripts\\package-extension.ps1 before live QA");

  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check"
    ],
    viewport: { width: 1440, height: 1000 }
  });

  const results = [];
  try {
    for (const site of selectedSites()) {
      const page = await browser.newPage();
      try {
        const result = await testSite(page, site);
        results.push(result);
        await page.screenshot({
          path: path.join(outputDir, `${site.id}.png`),
          fullPage: true
        }).catch(() => {});
      } catch (error) {
        results.push({
          name: site.name,
          status: "blocked",
          detail: `Live page could not be tested: ${error.message}`
        });
      } finally {
        if (!page.isClosed()) {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outputDir, "results.json");
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  const failed = results.filter((result) => result.status !== "passed");
  console.table(results.map(({ name, status, detail }) => ({ name, status, detail })));
  if (failed.length > 0) {
    throw new Error(`Live QA did not pass for ${failed.map((result) => result.name).join(", ")}. See ${reportPath}`);
  }

  console.log(`Live Playwright QA passed. Results: ${reportPath}`);
}

function selectedSites() {
  if (requestedSites.size === 0) {
    return SITES;
  }

  return SITES.filter((site) => requestedSites.has(site.id) || requestedSites.has(site.name.toLowerCase()));
}

async function testSite(page, site) {
  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const editor = await findEditor(page, site.editorSelectors, 120000);
  if (!editor) {
    return {
      name: site.name,
      status: "blocked",
      detail: "Prompt editor not found. Log in in the opened Chrome window, then rerun this test."
    };
  }

  await clearEditor(page, editor);
  await page.evaluate((text) => navigator.clipboard.writeText(text), SAMPLE);
  await editor.click({ timeout: 10000 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await page.waitForTimeout(1000);

  const text = await readEditorText(editor);
  const expectedPatterns = [
    /\[\[PERSON_1\]\]/,
    /\[\[EMAIL_1\]\]/,
    /\[\[PHONE_1\]\]/,
    /\[\[CREDIT_CARD_1\]\]/,
    /\[\[OPENAI_API_KEY_1\]\]/,
    /\[\[ADDRESS_1\]\]/,
    /\[\[ADDRESS_2\]\]/
  ];
  const leakedPatterns = [
    /Jane Smith/,
    /jane\.smith@example\.com/,
    /\+1 415-555-0199/,
    /4111 1111 1111 1111/,
    /sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/,
    /906 W 2ND AVE/,
    /SPOKANE, WA 99201-4540/
  ];

  const missing = expectedPatterns.filter((pattern) => !pattern.test(text)).map(String);
  const leaked = leakedPatterns.filter((pattern) => pattern.test(text)).map(String);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z").catch(() => {});

  if (missing.length || leaked.length) {
    return {
      name: site.name,
      status: "failed",
      detail: `Missing ${missing.join(", ") || "none"}; leaked ${leaked.join(", ") || "none"}`
    };
  }

  return {
    name: site.name,
    status: "passed",
    detail: "Paste redacted and no original sensitive sample values remained in editor."
  };
}

async function findEditor(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      if (page.isClosed()) {
        return null;
      }
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0)) {
        if (await locator.isVisible().catch(() => false)) {
          return locator;
        }
      }
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

async function clearEditor(page, editor) {
  await editor.click({ timeout: 10000 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
}

async function readEditorText(editor) {
  return await editor.evaluate((element) => {
    if ("value" in element) {
      return element.value;
    }
    return element.innerText || element.textContent || "";
  });
}

function validatePackageInputs() {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8"));
  assert.equal(manifest.permissions.includes("clipboardWrite"), false, "clipboardWrite must not be present");
  assert.equal(Boolean(manifest.content_scripts && manifest.content_scripts.length), true, "content script required");
}
