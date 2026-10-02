// Background service worker. It keeps the content script registered on the
// optional sites the user has allowed, and runs the optional name-detection
// model: it creates the offscreen document that runs the model and forwards
// requests from content scripts and the popup to it.

import { MESSAGES, NAME_MODEL_READY_KEY, OFFSCREEN_TARGET } from "./shared/nameModel.js";
import { syncSiteScripts } from "./siteRegistration.js";

// Optional sites (Perplexity, Grok...): register the content script where
// the user has allowed it.
const sync = () => {
  syncSiteScripts(/** @type {any} */ (chrome)).catch((error) => console.warn("SafePaste: could not update site scripts", error));
};
chrome.runtime.onInstalled.addListener((details) => {
  sync();
  // First install: show the welcome page with a practice paste.
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") }).catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(sync);
chrome.permissions.onAdded.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);

const OFFSCREEN_URL = "offscreen.html";
const FORWARDED = new Set([MESSAGES.detect, MESSAGES.prepare, MESSAGES.status]);

/** @type {Promise<void> | null} */
let creating = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target === OFFSCREEN_TARGET) {
    return false;
  }
  if (message.type === MESSAGES.progress) {
    if (message.status && message.status.state === "ready") {
      chrome.storage.local.set({ [NAME_MODEL_READY_KEY]: true });
    }
    return false;
  }
  if (message.type === MESSAGES.unload) {
    unload()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: String(error && error.message ? error.message : error) }));
    return true;
  }
  if (!FORWARDED.has(message.type)) {
    return false;
  }
  forward(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error && error.message ? error.message : error) }));
  return true;
});

/** @param {{ type: string, text?: string }} message */
async function forward(message) {
  const running = await hasOffscreenDocument();
  if (!running && message.type !== MESSAGES.prepare) {
    const stored = await chrome.storage.local.get(NAME_MODEL_READY_KEY);
    const downloaded = Boolean(stored[NAME_MODEL_READY_KEY]);
    // Answer status questions without starting the model.
    if (message.type === MESSAGES.status) {
      return { status: { state: downloaded ? "downloaded" : "absent" } };
    }
    // A paste must never start the model download; the popup does that.
    if (!downloaded) {
      return { error: "The name model has not been downloaded yet." };
    }
  }
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: OFFSCREEN_TARGET });
}

/** Closes the offscreen document, so the model is no longer in memory or in use. */
async function unload() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
  await chrome.storage.local.remove(NAME_MODEL_READY_KEY);
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [/** @type {chrome.runtime.ContextType} */ ("OFFSCREEN_DOCUMENT")],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [/** @type {chrome.offscreen.Reason} */ ("WORKERS")],
        justification: "Runs the optional on-device name detection model on pasted text."
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}
