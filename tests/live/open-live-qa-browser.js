import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionPath = path.join(root, "dist", "safepaste-ai");
// Kept outside the repository: it holds real logins to the AI sites.
const profileDir = process.env.SAFEPASTE_QA_PROFILE || path.join(os.homedir(), ".safepaste-ai", "playwright-profile");
const qaPath = path.join(root, "LIVE_SITE_QA.md");

const urls = [
  "https://chatgpt.com/",
  "https://gemini.google.com/app",
  "https://claude.ai/"
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error("Built extension not found. Run npm run build first.");
  }

  const context = await chromium.launchPersistentContext(profileDir, {
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

  for (const url of urls) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  }

  console.log("Opened Chrome with the packaged extension loaded.");
  console.log(`Use the QA checklist: ${qaPath}`);
  console.log("If Cloudflare or login appears, complete it in the opened browser window.");
  console.log("The browser will stay open until you press Enter here.");

  const rl = readline.createInterface({ input, output });
  await rl.question("");
  rl.close();
  await context.close();
}
