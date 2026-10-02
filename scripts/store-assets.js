// Renders the extension icons and the Chrome Web Store images.
//
//   npm run build && npm run assets
//
// Icons come from store-assets/brand/logo.svg (and logo-16.svg for the
// toolbar). Store images show the real built extension, framed in the flat
// design of the popup. Needs the network for the Inter font.
//
//   npm run assets -- --gemini
//
// refreshes the captures from the real Gemini site with the live QA profile
// (~/.safepaste-ai/playwright-profile): a redacted paste with the review
// chip, the open review list, a code paste, and the popup. They are cropped
// to the prompt box and SafePaste's own UI so nothing else on the page
// (account, location) is kept, and saved in store-assets/captures/. Only
// made-up text is pasted; nothing is sent, and the prompt is cleared after.
// The reply image is captured on every run from a neutral demo chat page.

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
const CAPTURE_FILES = ["customer", "review", "code", "popup", "popup-types"];
const PASTE = process.platform === "darwin" ? "Meta+V" : "Control+V";
const SELECT_ALL = process.platform === "darwin" ? "Meta+A" : "Control+A";

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
// The popup's palette (static/popup.css).
const C = { accent: "#3034A6", deep: "#262A8C", soft: "#E7E8FA", bg: "#F1F2F5", surface: "#FFFFFF", border: "#D6D8E1", line: "#E4E5EB", text: "#15161E", muted: "#464A59", mint: "#A7F3D0", onAccentMuted: "#DADBF7", red: "#FDE2E1", redInk: "#9F1F14" };
const CREDIT = "Shown on Gemini. SafePaste AI is independent and not affiliated with Google.";

if (!existsSync(join(extensionPath, "manifest.json"))) {
  throw new Error("Built extension not found. Run npm run build first.");
}

await renderIcons();
if (process.argv.includes("--gemini")) {
  await captureGemini();
}
const captures = loadCaptures();
if (!captures) {
  throw new Error("No Gemini captures in store-assets/captures. Run: npm run assets -- --gemini");
}
captures.reply = await captureReply();
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
 * Saved captures as data URIs, or null if any is missing.
 * @returns {Record<string, string> | null}
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
  return images;
}

/** Pastes the demo texts into the real Gemini prompt and saves tight crops. */
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
      await page.keyboard.press(SELECT_ALL);
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(300);
    };
    // The rounded prompt card around the editor.
    const cardRect = () => editor.evaluate((element) => {
      let node = element.parentElement;
      while (node && !(parseFloat(getComputedStyle(node).borderTopLeftRadius) >= 20 && node.getBoundingClientRect().width > 400)) {
        node = node.parentElement;
      }
      const rect = (node || element).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    try {
      for (const [name, text] of /** @type {const} */ ([["customer", CUSTOMER_EMAIL], ["code", CODE_PASTE]])) {
        await clear();
        await page.evaluate((value) => navigator.clipboard.writeText(value), text);
        await page.keyboard.press(PASTE);
        await page.waitForTimeout(900);
        if (/rebecca\.thornton@|sk-proj-Qx7L|Winter-Harbor/.test(await editor.innerText())) {
          throw new Error(`The ${name} sample was not redacted on Gemini; not capturing it.`);
        }
        const card = await cardRect();
        // Includes SafePaste's "hidden · Review" chip on the top edge of the box.
        await page.screenshot({ path: join(captureDir, `${name}.png`), clip: { x: card.x - 16, y: card.y - 34, width: card.width + 32, height: card.height + 50 } });

        if (name === "customer") {
          // Open the review list (the chip sits just above the editor's right end).
          const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await editor.boundingBox());
          await page.mouse.click(box.x + box.width - 60, box.y - 24);
          await page.waitForTimeout(400);
          // Just the review list and the prompt box, below the page's header links.
          const top = Math.max(0, card.y - 320);
          await page.screenshot({ path: join(captureDir, "review.png"), clip: { x: card.x - 16, y: top, width: card.width + 32, height: card.y + card.height + 16 - top } });
          await page.keyboard.press("Escape");
        }
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
    // "What to redact", not "AI sites": a screenshot listing many AI brands
    // counts as keyword spam in the store.
    await popup.click("#openTypes");
    // Wait for the slide-in to finish.
    await popup.waitForSelector("#typesView.here");
    await popup.waitForTimeout(600);
    await popup.locator(".app").screenshot({ path: join(captureDir, "popup-types.png") });
  } finally {
    await context.close();
  }
}

/**
 * A reply that uses placeholders, with the hover card and "Copy reply with
 * real values", on a neutral demo chat page with the real extension.
 * @returns {Promise<string>} PNG data URI
 */
async function captureReply() {
  const profile = join(tmpdir(), `safepaste-assets-${Date.now()}`);
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 820, height: 470 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    permissions: ["clipboard-read", "clipboard-write"]
  });
  try {
    // The content script runs on supported sites only, so the demo page is
    // served at a supported address. It does not imitate any real site.
    await context.route("https://chatgpt.com/**", (route) => route.fulfill({ contentType: "text/html", body: demoChatPage() }));
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/");
    await page.waitForTimeout(400);
    await page.evaluate((value) => navigator.clipboard.writeText(value), CUSTOMER_EMAIL);
    await page.click("#prompt-textarea");
    await page.keyboard.press(PASTE);
    await page.waitForTimeout(300);
    // The message as sent, and the AI's reply to it.
    await page.evaluate(() => {
      const box = /** @type {HTMLTextAreaElement} */ (document.getElementById("prompt-textarea"));
      /** @type {HTMLElement} */ (document.getElementById("sent")).textContent = box.value.split("\n").slice(0, 3).join("\n") + "\n…";
      box.value = "";
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.blur();
      /** @type {HTMLElement} */ (document.getElementById("reply")).innerHTML =
        "<p>Here is a draft you can send:</p><p>Dear [[PERSON_1]],</p><p>I am sorry your order has not arrived. We are sending a replacement to [[ADDRESS_1]] today, and the tracking number will go to [[EMAIL_1]] within the hour.</p><p>Kind regards,<br>Customer Support</p>";
    });
    await page.waitForTimeout(600);
    const target = await page.evaluate(() => {
      const paragraph = /** @type {HTMLElement} */ (document.querySelectorAll("#reply p")[2]);
      const text = /** @type {Text} */ (paragraph.firstChild);
      const index = (text.nodeValue || "").indexOf("[[EMAIL_1]]");
      const range = document.createRange();
      range.setStart(text, index + 4);
      range.setEnd(text, index + 5);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(300);
    return `data:image/png;base64,${(await page.screenshot()).toString("base64")}`;
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
    body { margin: 0; font: 15px/1.6 Inter, system-ui, sans-serif; color: ${C.text}; background: #FFFFFF; }
    .top { display: flex; align-items: center; gap: 10px; padding: 12px 22px; border-bottom: 1px solid ${C.line}; font-weight: 700; }
    .dot { width: 22px; height: 22px; border-radius: 6px; background: ${C.soft}; }
    .thread { padding: 18px 28px 90px; }
    .sent { margin-left: auto; max-width: 70%; padding: 10px 14px; border-radius: 14px; background: ${C.bg}; color: ${C.muted}; white-space: pre-wrap; font-size: 13.5px; }
    .reply p { margin: 10px 0; }
    .composer { position: fixed; left: 28px; right: 28px; bottom: 20px; padding: 12px 14px; border: 1px solid ${C.border}; border-radius: 14px; background: #fff; }
    textarea { width: 100%; height: 26px; border: 0; outline: 0; resize: none; font: 14.5px Inter, system-ui, sans-serif; color: ${C.text}; }
  </style></head><body>
    <div class="top"><span class="dot"></span>AI chat</div>
    <div class="thread"><div class="sent" id="sent"></div><div class="reply" id="reply" data-message-author-role="assistant"></div></div>
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

/** @param {Record<string, string>} shots */
async function renderStoreImages(shots) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (/** @type {string} */ body, /** @type {number} */ width, /** @type {number} */ height, /** @type {string} */ file) => {
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONT}<style>${css()}</style></head><body style="width:${width}px;height:${height}px">${body}</body></html>`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(outDir, file), clip: { x: 0, y: 0, width, height } });
  };
  const mark = (/** @type {number} */ size) => `<img class="mark" src="${dataUri(logoMark)}" width="${size}" height="${size}" alt="">`;
  /**
   * Indigo panel with the message, light panel with the product.
   * @param {{ eyebrow: string, title: string, text: string, points?: string[] }} copy
   * @param {string} visual
   */
  const shot = (copy, visual) => `<div class="shot">
    <div class="panel">
      <div class="brand">${mark(40)}<span>SafePaste AI</span></div>
      <div class="eyebrow">${copy.eyebrow}</div>
      <h1>${copy.title}</h1>
      <p>${copy.text}</p>
      ${copy.points ? `<ul>${copy.points.map((point) => `<li>${point}</li>`).join("")}</ul>` : ""}
    </div>
    <div class="stage">${visual}</div>
  </div>`;
  const copied = (/** @type {string} */ text, /** @type {boolean} */ code) => `<div class="copied${code ? " code" : ""}"><div class="label">You copy</div><pre>${highlighted(text)}</pre></div>`;
  const step = `<div class="step"><span class="key">Ctrl</span>+<span class="key">V</span><span class="arrow">&darr;</span></div>`;

  mkdirSync(outDir, { recursive: true });

  await render(shot(
    { eyebrow: "Paste safely", title: "Personal data never reaches the AI.", text: "Paste as usual. Names, emails, phone and card numbers become placeholders the moment you paste." },
    `<div class="column">${copied(CUSTOMER_EMAIL, false)}${step}<div class="label">Gemini receives</div><img class="ui" src="${shots.customer}" alt=""><div class="credit">${CREDIT}</div></div>`
  ), 1280, 800, "screenshot-1-1280x800.png");

  await render(shot(
    { eyebrow: "Real values back", title: "Get the real names back in one click.", text: "Hover a placeholder to see what it hides. Copy the reply and every real value is filled back in, ready to send." },
    `<img class="ui big" src="${shots.reply}" alt="">`
  ), 1280, 800, "screenshot-2-1280x800.png");

  await render(shot(
    { eyebrow: "Always in control", title: "See what was hidden. Undo any of it.", text: "A short list by the prompt box shows every hidden value. Unhide puts one back before you send." },
    `<div class="column"><img class="ui" src="${shots.review}" alt=""><div class="credit">${CREDIT}</div></div>`
  ), 1280, 800, "screenshot-3-1280x800.png");

  await render(shot(
    { eyebrow: "For developers too", title: "API keys and passwords stay private.", text: "Over 200 secret formats from the open-source gitleaks rules, plus passwords in configs and connection strings." },
    `<div class="column">${copied(CODE_PASTE, true)}${step}<div class="label">Gemini receives</div><img class="ui" src="${shots.code}" alt=""><div class="credit">${CREDIT}</div></div>`
  ), 1280, 800, "screenshot-4-1280x800.png");

  await render(shot(
    { eyebrow: "Private by design", title: "Everything stays on your computer.", text: "No account and no servers. Choose how strict to be, what to hide, and where SafePaste works.", points: ["Works on popular AI chats, more with one click", "Blocks a paste it cannot check, never sends it unchecked", "Free, with no tracking"] },
    `<div class="pair"><img class="ui popup" src="${shots.popup}" alt=""><img class="ui popup" src="${shots["popup-types"]}" alt=""></div>`
  ), 1280, 800, "screenshot-5-1280x800.png");

  await render(`<div class="promo">
    ${mark(72)}
    <div><div class="promo-name">SafePaste AI</div><div class="promo-line">Paste into AI chats without leaking personal data</div>
    <div class="chips"><span class="chip">[[EMAIL_1]]</span><span class="chip">[[PHONE_1]]</span></div></div>
  </div>`, 440, 280, "promo-small-440x280.png");

  await render(`<div class="marquee">
    <div class="m-copy">${mark(76)}<h1>Paste into AI chats without leaking personal data or secrets.</h1><p>Automatic, on-device redaction for AI chats. Free.</p></div>
    <div class="m-stage"><img class="ui" src="${shots.customer}" alt=""></div>
  </div>`, 1400, 560, "marquee-1400x560.png");

  await browser.close();
}

function css() {
  return `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, system-ui, sans-serif; color: ${C.text}; background: ${C.bg}; -webkit-font-smoothing: antialiased; overflow: hidden; }
  .shot { display: grid; grid-template-columns: 470px 1fr; height: 800px; }
  .panel { display: flex; flex-direction: column; justify-content: center; padding: 0 52px 0 60px; background: ${C.accent}; color: #FFFFFF; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 44px; font-size: 20px; font-weight: 700; }
  .mark { border-radius: 10px; background: #FFFFFF; }
  .eyebrow { margin-bottom: 14px; color: ${C.mint}; font-size: 15px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .panel h1 { margin: 0 0 18px; font-size: 44px; line-height: 1.1; font-weight: 800; letter-spacing: -0.02em; }
  .panel p { margin: 0; color: ${C.onAccentMuted}; font-size: 19px; line-height: 1.5; }
  .panel ul { margin: 26px 0 0; padding: 0; list-style: none; }
  .panel li { position: relative; margin-bottom: 12px; padding-left: 28px; font-size: 16.5px; line-height: 1.4; }
  .panel li::before { content: ""; position: absolute; left: 0; top: 5px; width: 14px; height: 14px; border-radius: 4px; background: ${C.mint}; }
  .stage { display: flex; align-items: center; justify-content: center; padding: 40px 48px; }
  .column { width: 100%; max-width: 700px; }
  .label { margin: 0 0 8px 2px; color: ${C.muted}; font-size: 12.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .copied { padding: 14px 18px; border: 1px solid ${C.border}; border-radius: 12px; background: ${C.surface}; }
  .copied .label { margin: 0 0 6px; }
  pre { margin: 0; white-space: pre-wrap; font: 14px/1.6 Inter, system-ui, sans-serif; }
  .copied.code pre { font: 12.5px/1.65 'JetBrains Mono', monospace; white-space: pre; }
  mark { padding: 0 3px; border-radius: 4px; background: ${C.red}; color: ${C.redInk}; }
  .step { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 12px 0; color: ${C.muted}; font-size: 14px; }
  .key { padding: 3px 9px; border: 1px solid ${C.border}; border-bottom-width: 3px; border-radius: 6px; background: ${C.surface}; color: ${C.text}; font-weight: 700; }
  .arrow { margin-left: 8px; color: ${C.accent}; font-size: 20px; font-weight: 800; }
  .ui { display: block; width: 100%; border: 1px solid ${C.border}; border-radius: 12px; background: ${C.surface}; }
  .ui.big { max-height: 700px; width: auto; max-width: 100%; }
  .credit { margin-top: 10px; color: ${C.muted}; font-size: 12px; }
  .pair { display: flex; gap: 24px; }
  .ui.popup { width: 330px; }
  .promo { display: flex; align-items: center; gap: 22px; height: 280px; padding: 0 34px; background: ${C.accent}; color: #FFFFFF; }
  .promo-name { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
  .promo-line { margin: 6px 0 14px; color: ${C.onAccentMuted}; font-size: 16px; line-height: 1.35; }
  .chips { display: flex; gap: 6px; }
  .chip { padding: 4px 8px; border-radius: 6px; background: ${C.mint}; color: #0B3B26; font: 700 13px 'JetBrains Mono', monospace; }
  .marquee { display: grid; grid-template-columns: 640px 1fr; height: 560px; }
  .m-copy { display: flex; flex-direction: column; justify-content: center; padding: 0 64px; background: ${C.accent}; color: #FFFFFF; }
  .m-copy h1 { margin: 26px 0 14px; font-size: 40px; line-height: 1.12; font-weight: 800; letter-spacing: -0.02em; }
  .m-copy p { margin: 0; color: ${C.onAccentMuted}; font-size: 19px; }
  .m-stage { display: flex; align-items: center; justify-content: center; padding: 40px; background: ${C.bg}; }
`;
}
