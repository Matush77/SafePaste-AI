// Renders the extension icons and the Chrome Web Store images.
//
//   npm run build && npm run assets
//
// Icons come from store-assets/brand/logo.svg (and logo-16.svg for the
// toolbar). Store screenshots show the real built extension: it is loaded
// into Chromium, text is pasted, and the result, the on-page notice and the
// popup are captured and framed. Needs the network once for the Inter font.
//
//   npm run assets -- --gemini
//
// captures from the real Gemini site with the live QA profile instead
// (~/.safepaste-ai/playwright-profile), cropped to the prompt box and the
// SafePaste notice so nothing else on the page (account, location) is kept,
// and saves the crops in store-assets/captures/ for later runs. It only
// pastes made-up text, never sends it, and clears the prompt afterwards.
// Without captures, a neutral demo chat page is used.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { detect } from "../src/redactor.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "store-assets", "brand");
const outDir = join(root, "store-assets");
const iconDir = join(root, "static", "assets");
const extensionPath = join(root, "dist", "safepaste-ai");
const captureDir = join(root, "store-assets", "captures");
const CAPTURE_FILES = ["customer", "code", "popup"];
const PASTE = process.platform === "darwin" ? "Meta+V" : "Control+V";

const logo = readFileSync(join(brandDir, "logo.svg"), "utf8");
const logoMark = logo.replace('viewBox="0 0 128 128" width="128" height="128"', 'viewBox="16 16 96 96" width="96" height="96"');
const logo16 = readFileSync(join(brandDir, "logo-16.svg"), "utf8");
const dataUri = (/** @type {string} */ svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// Demo texts. Token-shaped values are assembled so secret scanners do not
// flag this file; all values are made up.
const CUSTOMER_EMAIL = [
  "Please draft a polite reply to this customer:",
  "From: Rebecca Thornton <rebecca.thornton@gmail.com>",
  "Phone: (614) 555-0187",
  "Ship to: 4417 Maple Ridge Dr, Columbus, OH 43215",
  "Card on file: 4111 1111 1111 1111",
  "She says her order never arrived."
].join("\n");
const CODE_PASTE = [
  "Why does this return 401?",
  `OPENAI_API_KEY=${"sk-proj-"}Qx7Lm2Vr9Tz4Kp8Nw3Hs6Jd1Fg5Bc0Ya`,
  `DB_URL=postgres://app:${"Winter-Harbor-"}2291@10.0.3.21/orders`,
  `GITHUB_TOKEN=${"ghp"}_Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa`
].join("\n");

const FONT = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">`;
const COLORS = { indigo: "#2E3192", deep: "#1B1E5E", mint: "#34D399", ink: "#12142B", muted: "#5B6078", page: "#F4F5FB", line: "#DEE1F0", red: "#FDE2E1", redInk: "#B42318" };

if (!existsSync(join(extensionPath, "manifest.json"))) {
  throw new Error("Built extension not found. Run npm run build first.");
}

await renderIcons();
if (process.argv.includes("--gemini")) {
  await captureGemini();
}
const captures = loadCaptures() || { ...(await captureDemo()), site: null };
await renderStoreImages(captures);
console.log("Icons written to static/assets, store images to store-assets.");

async function renderIcons() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (/** @type {string} */ svg, /** @type {number} */ size, /** @type {string} */ path) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent"><img src="${dataUri(svg)}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  await render(logo16, 16, join(iconDir, "icon-16.png"));
  await render(logoMark, 32, join(iconDir, "icon-32.png"));
  await render(logoMark, 48, join(iconDir, "icon-48.png"));
  // The 128 px icon keeps Chrome's recommended 16 px transparent padding.
  await render(logo, 128, join(iconDir, "icon-128.png"));
  writeFileSync(join(iconDir, "logo.svg"), logoMark);
  await browser.close();
}

/**
 * Saved Gemini captures as data URIs, or null if there are none.
 * @returns {Record<string, string> & { site: string } | null}
 */
function loadCaptures() {
  if (!CAPTURE_FILES.every((name) => existsSync(join(captureDir, `${name}.png`)))) {
    return null;
  }
  /** @type {Record<string, string>} */
  const images = {};
  for (const name of CAPTURE_FILES) {
    images[name] = `data:image/png;base64,${readFileSync(join(captureDir, `${name}.png`)).toString("base64")}`;
  }
  return { ...images, site: "Gemini" };
}

/**
 * Pastes the demo texts into the real Gemini prompt with the built extension
 * and saves tight crops of the prompt box and the SafePaste notice.
 */
async function captureGemini() {
  const profile = process.env.SAFEPASTE_QA_PROFILE || join(homedir(), ".safepaste-ai", "playwright-profile");
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run", "--no-default-browser-check"]
  });
  mkdirSync(captureDir, { recursive: true });
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://gemini.google.com" });
    const page = await context.newPage();
    await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });
    const editor = page.locator("rich-textarea [contenteditable='true']").first();
    await editor.waitFor({ timeout: 90000 });
    await page.waitForTimeout(2500);
    const clear = async () => {
      await editor.click();
      await page.keyboard.press(`${PASTE.split("+")[0]}+A`);
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(300);
    };

    try {
      for (const [name, text] of /** @type {const} */ ([["customer", CUSTOMER_EMAIL], ["code", CODE_PASTE]])) {
        await clear();
        await page.evaluate((value) => navigator.clipboard.writeText(value), text);
        await page.keyboard.press(PASTE);
        await page.waitForTimeout(700);
        const pasted = await editor.innerText();
        if (/rebecca\.thornton@|sk-proj-Qx7L|Winter-Harbor/.test(pasted)) {
          throw new Error(`The ${name} sample was not redacted on Gemini; not capturing it.`);
        }
        // The rounded prompt card around the editor, and nothing else.
        const card = await editor.evaluate((element) => {
          let node = element.parentElement;
          while (node && !(parseFloat(getComputedStyle(node).borderTopLeftRadius) >= 20 && node.getBoundingClientRect().width > 400)) {
            node = node.parentElement;
          }
          const rect = (node || element).getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
        // Includes SafePaste's "hidden · Review" chip, which overlaps the top of the prompt box.
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(captureDir, `${name}.png`), clip: { x: card.x - 16, y: card.y - 34, width: card.width + 32, height: card.height + 50 } });
      }
    } finally {
      await clear();
    }

    const extensionId = await findExtensionId(context);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 560 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // A scrollbar is noise in a store image.
    await popup.addStyleTag({ content: ".view { scrollbar-width: none; }" });
    await popup.waitForTimeout(600);
    await popup.locator(".app").screenshot({ path: join(captureDir, "popup.png") });
  } finally {
    await context.close();
  }
}

/**
 * Pastes the demo texts into a neutral demo chat page with the real
 * extension and returns the captured images as data URIs.
 */
async function captureDemo() {
  const profile = join(tmpdir(), `safepaste-assets-${Date.now()}`);
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 760, height: 520 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    permissions: ["clipboard-read", "clipboard-write"]
  });
  try {
    // The content script runs on supported sites only, so the demo page is
    // served at a supported address. It does not imitate any real site.
    await context.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html", body: demoChatPage() }));
    const extensionId = await findExtensionId(context);
    const page = await context.newPage();

    const paste = async (/** @type {string} */ text) => {
      await page.goto("https://chatgpt.com/");
      await page.waitForTimeout(300);
      await page.evaluate(async (value) => navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([value], { type: "text/plain" }) })]), text);
      await page.click("#prompt-textarea");
      await page.keyboard.press(PASTE);
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        const box = /** @type {HTMLTextAreaElement} */ (document.querySelector("#prompt-textarea"));
        box.style.height = `${box.scrollHeight + 4}px`;
        box.blur();
      });
      return `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
    };
    const customer = await paste(CUSTOMER_EMAIL);
    const code = await paste(CODE_PASTE);

    await page.setViewportSize({ width: 360, height: 560 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.addStyleTag({ content: ".view { scrollbar-width: none; }" });
    await page.waitForTimeout(500);
    const popup = `data:image/png;base64,${(await page.locator(".app").screenshot()).toString("base64")}`;
    return { customer, code, popup };
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
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
  if (!id) {
    throw new Error("SafePaste AI is not loaded");
  }
  return id;
}

function demoChatPage() {
  return `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>
    body { margin: 0; font: 15px/1.5 Inter, system-ui, sans-serif; color: ${COLORS.ink}; background: #FFFFFF; }
    .top { display: flex; align-items: center; gap: 10px; padding: 14px 22px; border-bottom: 1px solid ${COLORS.line}; font-weight: 600; }
    .dot { width: 26px; height: 26px; border-radius: 8px; background: #E8E9F7; }
    .chat { padding: 22px 22px 0; }
    .bubble { background: ${COLORS.page}; border-radius: 14px; padding: 12px 16px; max-width: 520px; color: ${COLORS.muted}; }
    .composer { position: absolute; left: 22px; right: 22px; bottom: 22px; border: 1px solid ${COLORS.line}; border-radius: 16px; padding: 12px 14px 16px; box-shadow: 0 6px 24px rgba(18, 20, 43, 0.08); }
    textarea { width: 100%; border: 0; outline: 0; resize: none; font: 14.5px/1.6 Inter, system-ui, sans-serif; color: ${COLORS.ink}; height: 60px; overflow: hidden; }
  </style></head><body>
    <div class="top"><span class="dot"></span>AI chat</div>
    <div class="chat"><div class="bubble">Hi! How can I help you today?</div></div>
    <div class="composer"><textarea id="prompt-textarea" spellcheck="false" placeholder="Message the assistant"></textarea></div>
  </body></html>`;
}

/**
 * The text with every value SafePaste redacts highlighted, as HTML.
 * @param {string} text
 */
function highlighted(text) {
  const escape = (/** @type {string} */ value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = "";
  let cursor = 0;
  for (const match of detect(text)) {
    html += escape(text.slice(cursor, match.start)) + `<mark>${escape(text.slice(match.start, match.end))}</mark>`;
    cursor = match.end;
  }
  return html + escape(text.slice(cursor));
}

/** @param {Record<string, string> & { site: string | null }} captures */
async function renderStoreImages(captures) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (/** @type {string} */ body, /** @type {number} */ width, /** @type {number} */ height, /** @type {string} */ file) => {
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONT}<style>${baseCss()}</style></head><body style="width:${width}px;height:${height}px">${body}</body></html>`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, file), clip: { x: 0, y: 0, width, height } });
  };
  const mark = (/** @type {number} */ size) => `<img src="${dataUri(logoMark)}" width="${size}" height="${size}" alt="">`;
  const brandRow = `<div class="brand">${mark(40)}<span>SafePaste AI</span></div>`;

  mkdirSync(outDir, { recursive: true });

  // Copied text | Ctrl+V | what the chat receives (plus the SafePaste notice).
  const flow = (/** @type {string} */ source, /** @type {string} */ name, /** @type {boolean} */ code) => `
    <div class="flow">
      <div class="card source${code ? " code" : ""}"><div class="label">You copy</div><pre>${highlighted(source)}</pre></div>
      <div class="step"><span class="key">Ctrl</span><span class="plus">+</span><span class="key">V</span><span class="step-arrow">&rarr;</span></div>
      <div class="frame">
        <div class="label light">${captures.site ? `${captures.site} receives` : "The AI chat receives"}</div>
        <img src="${captures[name]}" alt="">
        ${captures[`${name}-notice`] ? `<img class="notice" src="${captures[`${name}-notice`]}" alt="">` : ""}
        ${captures.site ? `<div class="credit">Shown on ${captures.site}. SafePaste AI is independent and not affiliated with Google.</div>` : ""}
      </div>
    </div>`;

  await render(`<div class="shot stacked">
    <div class="copy wide">${brandRow}
      <h1>Sensitive data is removed <em>before</em> the AI sees it.</h1>
      <p>Paste as usual. Works on ChatGPT, Gemini and Claude.</p>
    </div>
    ${flow(CUSTOMER_EMAIL, "customer", false)}
  </div>`, 1280, 800, "screenshot-1-1280x800.png");

  await render(`<div class="shot stacked">
    <div class="copy wide">${brandRow}
      <h1>API keys and passwords stay private.</h1>
      <p>200+ provider formats, plus passwords in configs and connection strings.</p>
    </div>
    ${flow(CODE_PASTE, "code", true)}
  </div>`, 1280, 800, "screenshot-2-1280x800.png");

  await render(`<div class="shot popup-shot">
    <div class="copy">${brandRow}
      <h1>You decide what gets redacted.</h1>
      <ul class="points">
        <li><b>Balanced or Strict</b> protection</li>
        <li>Turn each kind of data on or off</li>
        <li>Optional <b>on-device name detection</b></li>
        <li>See what the last paste redacted</li>
      </ul>
    </div>
    <div class="popup"><img src="${captures.popup}" alt=""></div>
  </div>`, 1280, 800, "screenshot-3-1280x800.png");

  await render(`<div class="shot privacy">
    <div class="copy wide">${brandRow}
      <h1>Private by design. Nothing leaves your device.</h1>
    </div>
    <div class="grid">
      <div class="tile"><h2>Nothing is sent anywhere</h2><p>Pasted text is checked inside your browser. SafePaste has no servers and no account.</p></div>
      <div class="tile"><h2>Fails safe</h2><p>If a paste cannot be checked, it is blocked instead of going through unredacted.</p></div>
      <div class="tile"><h2>Hidden links too</h2><p>Rich text whose links hide a token is pasted as plain text.</p></div>
      <div class="tile"><h2>ChatGPT, Gemini, Claude</h2><p>Works in the prompt box only. Search boxes, logins and other fields are never touched.</p></div>
    </div>
  </div>`, 1280, 800, "screenshot-4-1280x800.png");

  await render(`<div class="promo">
    ${mark(72)}
    <div><div class="promo-name">SafePaste AI</div><div class="promo-line">Redact before you paste<br>into AI chats</div>
    <div class="chips"><span class="chip">[[EMAIL_1]]</span><span class="chip">[[PHONE_1]]</span></div></div>
  </div>`, 440, 280, "promo-small-440x280.png");

  await render(`<div class="marquee">
    <div class="m-copy">${mark(84)}<h1>Paste into AI chats without leaking personal data or secrets.</h1><p>Local, automatic redaction for ChatGPT, Gemini and Claude.</p></div>
    <div class="m-demo"><div class="m-line"><span class="m-before">rebecca.thornton@gmail.com</span><span class="m-arrow">&rarr;</span><span class="chip">[[EMAIL_1]]</span></div>
    <div class="m-line"><span class="m-before">(614) 555-0187</span><span class="m-arrow">&rarr;</span><span class="chip">[[PHONE_1]]</span></div>
    <div class="m-line"><span class="m-before">4111 1111 1111 1111</span><span class="m-arrow">&rarr;</span><span class="chip">[[CREDIT_CARD_1]]</span></div>
    <div class="m-line"><span class="m-before">sk-proj-Qx7L&hellip;</span><span class="m-arrow">&rarr;</span><span class="chip">[[OPENAI_API_KEY_1]]</span></div></div>
  </div>`, 1400, 560, "marquee-1400x560.png");

  await browser.close();
}

function baseCss() {
  return `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, system-ui, sans-serif; color: ${COLORS.ink}; background: ${COLORS.page}; -webkit-font-smoothing: antialiased; overflow: hidden; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 20px; color: ${COLORS.deep}; }
  .brand img { border-radius: 10px; }
  .shot { display: flex; gap: 48px; padding: 56px 60px; height: 800px; align-items: center; background: linear-gradient(180deg, #FFFFFF 0%, ${COLORS.page} 100%); }
  .copy { width: 470px; flex: 0 0 auto; }
  .copy.wide { width: auto; }
  h1 { font-size: 40px; line-height: 1.12; letter-spacing: -0.02em; margin: 26px 0 16px; font-weight: 800; color: ${COLORS.ink}; }
  h1 em { font-style: normal; color: ${COLORS.indigo}; }
  .copy > p { font-size: 18px; line-height: 1.5; color: ${COLORS.muted}; margin: 0 0 26px; }
  .card { background: #FFFFFF; border: 1px solid ${COLORS.line}; border-radius: 16px; padding: 16px 18px; box-shadow: 0 8px 28px rgba(18, 20, 43, 0.06); }
  .label { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${COLORS.muted}; margin-bottom: 8px; }
  .label.light { margin: 0 0 10px 4px; }
  pre { margin: 0; white-space: pre-wrap; font: 13.5px/1.6 Inter, system-ui, sans-serif; color: ${COLORS.ink}; }
  .code pre { font: 12px/1.7 'JetBrains Mono', monospace; overflow-wrap: anywhere; }
  mark { background: ${COLORS.red}; color: ${COLORS.redInk}; border-radius: 4px; padding: 0 3px; }
  .frame { flex: 1; min-width: 0; }
  .frame img { width: 100%; display: block; border-radius: 18px; border: 1px solid ${COLORS.line}; box-shadow: 0 24px 60px rgba(27, 30, 94, 0.18); }
  .points { list-style: none; padding: 0; margin: 8px 0 0; font-size: 19px; line-height: 1.45; color: ${COLORS.muted}; }
  .points li { position: relative; padding-left: 34px; margin-bottom: 18px; }
  .points li::before { content: ""; position: absolute; left: 0; top: 4px; width: 20px; height: 20px; border-radius: 50%; background: ${COLORS.mint}; box-shadow: inset 0 0 0 6px #D1FAE5; }
  .points b { color: ${COLORS.ink}; }
  .popup-shot { justify-content: center; gap: 90px; }
  .popup img { width: 380px; display: block; border-radius: 16px; box-shadow: 0 24px 60px rgba(27, 30, 94, 0.2); max-height: 690px; object-fit: cover; object-position: top; border: 1px solid ${COLORS.line}; }
  .privacy { flex-direction: column; align-items: flex-start; justify-content: center; }
  .privacy h1 { max-width: 900px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 22px; width: 100%; }
  .tile { background: #FFFFFF; border: 1px solid ${COLORS.line}; border-radius: 18px; padding: 26px 28px; border-top: 5px solid ${COLORS.indigo}; }
  .tile h2 { margin: 0 0 8px; font-size: 22px; letter-spacing: -0.01em; }
  .tile p { margin: 0; font-size: 17px; line-height: 1.5; color: ${COLORS.muted}; }
  .promo { display: flex; align-items: center; gap: 22px; height: 280px; padding: 0 34px; background: linear-gradient(135deg, #3A3FB5 0%, ${COLORS.deep} 100%); color: #FFFFFF; }
  .promo img { border-radius: 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25); outline: 2px solid rgba(255, 255, 255, 0.25); }
  .promo-name { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
  .promo-line { font-size: 16px; color: #D5D7F5; margin: 6px 0 16px; line-height: 1.35; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font: 600 12.5px 'JetBrains Mono', monospace; background: rgba(52, 211, 153, 0.16); color: #7CF0C5; border: 1px solid rgba(52, 211, 153, 0.45); border-radius: 7px; padding: 4px 8px; white-space: nowrap; }
  .marquee { display: flex; align-items: center; gap: 70px; height: 560px; padding: 0 80px; background: linear-gradient(135deg, #3A3FB5 0%, ${COLORS.deep} 100%); color: #FFFFFF; }
  .m-copy { width: 600px; }
  .m-copy img { border-radius: 20px; outline: 2px solid rgba(255, 255, 255, 0.25); }
  .m-copy h1 { color: #FFFFFF; font-size: 44px; margin: 28px 0 14px; }
  .m-copy p { font-size: 20px; color: #D5D7F5; margin: 0; }
  .m-demo { flex: 1; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 22px; padding: 26px 28px; }
  .m-line { display: grid; grid-template-columns: 1fr 28px 230px; align-items: center; gap: 14px; padding: 13px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
  .m-line:last-child { border-bottom: 0; }
  .m-before { font: 15px 'JetBrains Mono', monospace; color: #FCA5A5; text-decoration: line-through; text-decoration-color: rgba(252, 165, 165, 0.6); }
  .m-arrow { color: #8E92D8; font-size: 20px; }
  .m-line .chip { font-size: 14px; justify-self: start; }
  .stacked { flex-direction: column; align-items: stretch; justify-content: center; gap: 34px; }
  .stacked h1 { margin: 22px 0 10px; }
  .stacked .copy > p { margin: 0; }
  .flow .code pre { font-size: 11px; overflow-wrap: normal; white-space: pre; }
  .flow { display: grid; grid-template-columns: 420px 118px 1fr; align-items: center; gap: 14px; }
  .step { display: flex; align-items: center; justify-content: center; gap: 5px; color: ${COLORS.muted}; }
  .key { font: 600 14px Inter, system-ui, sans-serif; color: ${COLORS.ink}; background: #FFFFFF; border: 1px solid ${COLORS.line}; border-bottom-width: 3px; border-radius: 7px; padding: 5px 9px; }
  .plus { font-size: 14px; }
  .step-arrow { font-size: 22px; margin-left: 6px; color: ${COLORS.indigo}; }
  .frame img.notice { width: auto; height: 36px; margin: 14px 0 0 auto; border-radius: 8px; border: 0; box-shadow: 0 10px 24px rgba(18, 20, 43, 0.25); }
  .credit { font-size: 12px; color: ${COLORS.muted}; margin-top: 12px; }
`;
}
