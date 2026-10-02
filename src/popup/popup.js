import { mergeSettings } from "../redactor.js";
import { MESSAGES, NAME_MODEL_SIZE_MB } from "../shared/nameModel.js";
import { LAST_REDACTION_KEY, SETTINGS_KEY } from "../shared/storageKeys.js";
import { OPTIONAL_SITES, SITE_LIST, originsOf, siteInfoForHostname } from "../shared/sites.js";
import { SUPPORTED_SITE_NAMES } from "../siteAdapters.js";

/**
 * @typedef {import("../redactor.js").Category} Category
 * @typedef {import("../shared/nameModel.js").NameModelStatus} NameModelStatus
 */

/** @type {{ name: string, categories: [Category, string][] }[]} */
const CATEGORY_GROUPS = [
  { name: "Secrets", categories: [["apiKeys", "API keys and tokens"], ["credentials", "Passwords and PINs"]] },
  { name: "Contact details", categories: [["emails", "Email addresses"], ["phones", "Phone numbers"], ["addresses", "Street addresses"]] },
  { name: "Money and IDs", categories: [["financial", "Cards, IBANs and accounts"], ["governmentIds", "ID, record and licence numbers"]] },
  { name: "People and places", categories: [["people", "Names"], ["organizations", "Companies and organisations"], ["locations", "Places"]] },
  { name: "Technical", categories: [["network", "IP and MAC addresses"], ["urls", "Web addresses (URLs)"]] }
];

const SENSITIVITY_HINTS = {
  balanced: "Hides values SafePaste is confident about. Best for everyday use, with the fewest false alarms.",
  strict: "Also hides likely matches, such as random-looking strings and place names on their own."
};

/** What each ⓘ explains. Values are HTML written here, never user data. */
const INFO = {
  notice: {
    title: "Show what was hidden",
    body: `<p>After a paste, a small chip appears above the prompt box, for example “3 hidden · Review”.</p>
      <p>Open it to see exactly what SafePaste replaced, and use <b>Unhide</b> to put a value back before you send.</p>
      <p>The chip is drawn in a part of the page the website cannot read.</p>`
  },
  restore: {
    title: "Real values in replies",
    body: `<p>SafePaste remembers which placeholder stands for which value, for this tab only.</p>
      <dl>
        <dt>Hover</dt><dd>Placeholders like [[PERSON_1]] in the AI's reply are highlighted. Hover one to see the real value.</dd>
        <dt>Copy</dt><dd>Select and copy a reply, or use “Copy reply with real values” by the prompt box: the real values are filled back in.</dd>
        <dt>Privacy</dt><dd>Real values are never written into the website's page, never stored and never sent anywhere. Closing or reloading the tab forgets them.</dd>
      </dl>`
  },
  model: {
    title: "Enhanced name detection",
    body: `${modelFacts()}
      <dl>
        <dt>What it does</dt><dd>Finds names the built-in rules miss, such as “Kowalski approved the budget”. It is an English model (DistilBERT) that recognises people, organisations and places.</dd>
        <dt>Turning it off</dt><dd>Stops using it but keeps the download, so turning it on again is instant. Use “Delete download” below to free the space.</dd>
        <dt>If it fails</dt><dd>If it cannot load or answer in time, pastes are still redacted with the built-in rules, and you are told.</dd>
      </dl>`
  }
};

// Where transformers.js keeps the model files (Cache Storage of this extension).
const MODEL_CACHE = "transformers-cache";

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const enabled = /** @type {HTMLInputElement} */ (byId("enabled"));
const tabStatus = byId("tabStatus");
const sensitivityInputs = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll("input[name='sensitivity']"));
const sensitivityHint = byId("sensitivityHint");
const nameModel = /** @type {HTMLInputElement} */ (byId("nameModel"));
const nameModelStatus = byId("nameModelStatus");
const progress = /** @type {HTMLElement} */ (document.querySelector(".progress"));
const categories = byId("categories");
const typesCount = byId("typesCount");
const placeholderStyle = /** @type {HTMLSelectElement} */ (byId("placeholderStyle"));
const showToast = /** @type {HTMLInputElement} */ (byId("showToast"));
const restoreValues = /** @type {HTMLInputElement} */ (byId("restoreValues"));
const lastRedaction = byId("lastRedaction");
const homeView = byId("homeView");
const typesView = byId("typesView");
const sitesView = byId("sitesView");

let settings = mergeSettings();
/** @type {import("../shared/sites.js").SiteInfo | null} */
let tabSite = null;
let tabSiteAllowed = false;
/** @type {NameModelStatus | null} */
let modelStatus = null;
// A one-off note shown while the feature is off, e.g. after deleting the download.
let modelNote = "";

init();

function init() {
  renderCategoryControls();
  byId("version").textContent = `v${chrome.runtime.getManifest().version}`;

  chrome.storage.sync.get(SETTINGS_KEY, (items) => {
    settings = mergeSettings(/** @type {Partial<import("../redactor.js").Settings> | undefined} */ (items[SETTINGS_KEY]));
    renderSettings();
  });
  chrome.storage.local.get(LAST_REDACTION_KEY, (items) => {
    renderLastRedaction(sanitizeLastRedaction(/** @type {any} */ (items[LAST_REDACTION_KEY])));
  });
  // Opening the popup grants activeTab, so the current tab's URL is visible
  // even on an optional site SafePaste is not allowed on yet.
  chrome.tabs.query({ active: true, currentWindow: true })
    .then(async ([tab]) => {
      tabSite = tab && tab.url ? siteInfoForHostname(new URL(tab.url).hostname) : null;
      tabSiteAllowed = Boolean(tabSite) && (!tabSite?.optional || (await chrome.permissions.contains({ origins: originsOf(/** @type {import("../shared/sites.js").SiteInfo} */ (tabSite)) })));
      renderTabStatus();
    })
    .catch(() => renderTabStatus());
  renderSites();

  enabled.addEventListener("change", () => updateSettings({ enabled: enabled.checked }));
  for (const input of sensitivityInputs) {
    input.addEventListener("change", () => updateSettings({ sensitivity: /** @type {"balanced" | "strict"} */ (input.value) }));
  }
  placeholderStyle.addEventListener("change", () => updateSettings({ placeholderStyle: /** @type {"typed" | "compact"} */ (placeholderStyle.value) }));
  showToast.addEventListener("change", () => updateSettings({ showToast: showToast.checked }));
  restoreValues.addEventListener("change", () => updateSettings({ restoreValues: restoreValues.checked }));

  nameModel.addEventListener("change", () => {
    if (!nameModel.checked) {
      updateSettings({ nameModel: false });
      renderModelStatus();
      return;
    }
    // Already downloaded: nothing to ask.
    if (modelStatus && (modelStatus.state === "downloaded" || modelStatus.state === "ready")) {
      enableModel();
      return;
    }
    // Ask before a 66 MB download.
    nameModel.checked = false;
    openSheet({
      title: "Download the name model?",
      body: `${modelFacts()}<p>It finds names the built-in rules miss. The download starts now and can take a minute or two; you can keep working meanwhile. You can turn it off or delete it any time from the ⓘ next to this setting.</p>`,
      primary: `Download ${NAME_MODEL_SIZE_MB} MB`,
      secondary: "Not now",
      opener: nameModel,
      onPrimary: () => {
        nameModel.checked = true;
        enableModel();
      }
    });
  });

  for (const button of document.querySelectorAll("button[data-info]")) {
    button.addEventListener("click", async () => {
      const kind = /** @type {keyof typeof INFO} */ (/** @type {HTMLElement} */ (button).dataset.info);
      const info = INFO[kind];
      if (kind !== "model") {
        openSheet({ title: info.title, body: info.body, primary: "Got it", opener: /** @type {HTMLElement} */ (button) });
        return;
      }
      const stored = await storedMegabytes();
      const usage = stored === null ? "" : `<p class="usage">${stored ? `Space used on this computer now: <b>${stored} MB</b>` : "Not downloaded. Nothing is stored on this computer."}</p>`;
      const error = modelStatus && modelStatus.state === "error" ? `<p class="error-detail">Last error: ${escapeHtml(modelStatus.error || "unknown")}</p>` : "";
      openSheet({
        title: info.title,
        body: usage + info.body + error,
        primary: "Got it",
        secondary: stored ? "Delete download" : undefined,
        onSecondary: deleteModel,
        opener: /** @type {HTMLElement} */ (button)
      });
    });
  }

  byId("openTypes").addEventListener("click", () => showView(typesView, byId("openTypes")));
  byId("openSites").addEventListener("click", () => showView(sitesView, byId("openSites")));
  for (const back of document.querySelectorAll("[data-back]")) {
    back.addEventListener("click", () => showView(null));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("sheet").hidden) {
      closeSheet();
    } else if (event.key === "Escape" && openSub) {
      showView(null);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === MESSAGES.progress) {
      modelStatus = message.status;
      renderModelStatus();
    }
  });
  requestModel(MESSAGES.status);
}

function enableModel() {
  updateSettings({ nameModel: true });
  requestModel(MESSAGES.prepare);
}

/** Facts about the name model download, for the sheets. */
function modelFacts() {
  return `<ul class="facts">
    <li><span>Size</span><b>about ${NAME_MODEL_SIZE_MB} MB, downloaded once</b></li>
    <li><span>From</span><b>Hugging Face (huggingface.co)</b></li>
    <li><span>Saved to</span><b>this computer, inside Chrome, in SafePaste's own storage</b></li>
    <li><span>Not saved to</span><b>your Downloads folder or any file you manage</b></li>
    <li><span>Removed</span><b>with “Delete download”, or when you remove SafePaste</b></li>
    <li><span>Runs</span><b>on this computer; pasted text never leaves Chrome</b></li>
    <li><span>Checked</span><b>one fixed version, SHA-256 verified</b></li>
  </ul>`;
}

/** Megabytes this extension currently stores (mostly the model), or null. */
async function storedMegabytes() {
  try {
    if (!(await caches.has(MODEL_CACHE))) {
      return 0;
    }
    const estimate = await navigator.storage.estimate();
    return Math.round((estimate.usage || 0) / 1e6);
  } catch (_error) {
    return null;
  }
}

/** Stops the model, deletes its files, and turns the feature off. */
async function deleteModel() {
  const before = await storedMegabytes();
  try {
    await chrome.runtime.sendMessage({ type: MESSAGES.unload });
    await caches.delete(MODEL_CACHE);
  } catch (_error) {
    // Reported below by the size check.
  }
  modelStatus = { state: "absent" };
  const left = await storedMegabytes();
  modelNote = left === 0 ? `Download deleted · ${before || NAME_MODEL_SIZE_MB} MB freed` : "Could not delete the download";
  updateSettings({ nameModel: false });
}

/** @param {string} type */
function requestModel(type) {
  chrome.runtime.sendMessage({ type })
    .then((response) => {
      modelStatus = response && response.status ? response.status : { state: "error", error: response && response.error };
      renderModelStatus();
    })
    .catch((error) => {
      modelStatus = { state: "error", error: String(error) };
      renderModelStatus();
    });
}

function renderModelStatus() {
  nameModelStatus.className = "row-status";
  progress.hidden = true;
  if (!nameModel.checked || !modelStatus) {
    nameModelStatus.textContent = nameModel.checked ? "" : modelNote;
    return;
  }
  modelNote = "";
  switch (modelStatus.state) {
    case "ready":
      nameModelStatus.classList.add("ok");
      nameModelStatus.textContent = "Ready · runs on this device";
      break;
    case "downloaded":
      nameModelStatus.classList.add("ok");
      nameModelStatus.textContent = "Downloaded · loads on your next paste";
      break;
    case "absent":
      nameModelStatus.textContent = "Not downloaded yet";
      break;
    case "loading":
      nameModelStatus.textContent = "Loading the model…";
      break;
    case "downloading": {
      const percent = Math.max(0, Math.min(100, Math.round(modelStatus.progress ?? 0)));
      nameModelStatus.textContent = `Downloading… ${percent}%`;
      progress.hidden = false;
      /** @type {HTMLElement} */ (progress.firstElementChild).style.width = `${percent}%`;
      break;
    }
    default:
      nameModelStatus.classList.add("error");
      nameModelStatus.textContent = "Could not load · built-in rules still work";
  }
}

/**
 * @param {{ title: string, body: string, primary: string, secondary?: string, opener: HTMLElement, onPrimary?: () => void, onSecondary?: () => void }} options
 */
function openSheet({ title, body, primary, secondary, opener, onPrimary, onSecondary }) {
  const layer = byId("sheet");
  const primaryButton = /** @type {HTMLButtonElement} */ (byId("sheetPrimary"));
  const secondaryButton = /** @type {HTMLButtonElement} */ (byId("sheetSecondary"));
  byId("sheetTitle").textContent = title;
  byId("sheetBody").innerHTML = body;
  primaryButton.textContent = primary;
  secondaryButton.hidden = !secondary;
  secondaryButton.textContent = secondary || "";
  primaryButton.onclick = () => {
    closeSheet();
    if (onPrimary) {
      onPrimary();
    }
  };
  secondaryButton.onclick = () => {
    closeSheet();
    if (onSecondary) {
      onSecondary();
    }
  };
  layer.onclick = (event) => {
    if (event.target === layer) {
      closeSheet();
    }
  };
  layer.hidden = false;
  /** @type {any} */ (layer).opener = opener;
  for (const view of document.querySelectorAll(".view")) {
    /** @type {HTMLElement} */ (view).inert = true;
  }
  // Keep the top of the sheet in view; focusing the button would scroll down.
  byId("sheet").querySelector(".sheet")?.scrollTo(0, 0);
  primaryButton.focus({ preventScroll: true });
}

function closeSheet() {
  const layer = byId("sheet");
  layer.hidden = true;
  homeView.inert = Boolean(openSub);
  if (openSub) {
    openSub.inert = false;
  }
  const opener = /** @type {any} */ (layer).opener;
  if (opener) {
    opener.focus();
  }
}

/** @type {HTMLElement | null} The open sub-screen ("AI sites", "What to redact"). */
let openSub = null;
/** @type {HTMLElement | null} */
let subOpener = null;

/**
 * Slides a sub-screen in over the home screen, or back out (view = null).
 * @param {HTMLElement | null} view
 * @param {HTMLElement} [opener] Gets focus back when the screen closes.
 */
function showView(view, opener) {
  if (view) {
    openSub = view;
    subOpener = opener || null;
    view.hidden = false;
    view.inert = false;
    homeView.inert = true;
    requestAnimationFrame(() => {
      view.classList.add("here");
      homeView.classList.add("away");
      /** @type {HTMLElement} */ (view.querySelector("[data-back]")).focus();
    });
    return;
  }
  const closing = openSub;
  if (!closing) {
    return;
  }
  openSub = null;
  closing.classList.remove("here");
  homeView.classList.remove("away");
  homeView.inert = false;
  closing.inert = true;
  setTimeout(() => {
    if (openSub !== closing) {
      closing.hidden = true;
    }
  }, 230);
  subOpener?.focus();
}

function renderTabStatus() {
  tabStatus.className = "status";
  if (!settings.enabled) {
    tabStatus.classList.add("paused");
    tabStatus.textContent = "Paused · pastes are not checked";
  } else if (tabSite && tabSiteAllowed) {
    tabStatus.classList.add("on");
    tabStatus.textContent = `Protecting this tab · ${tabSite.name}`;
  } else if (tabSite) {
    tabStatus.classList.add("paused");
    tabStatus.textContent = `Off on ${tabSite.name} · turn it on in AI sites`;
  } else {
    tabStatus.textContent = `Works on ${SUPPORTED_SITE_NAMES.join(", ")} and more`;
  }
}

/** The "AI sites" screen: built-in sites, and a switch per optional site. */
async function renderSites() {
  const builtIn = byId("builtInSites");
  const optional = byId("optionalSites");
  builtIn.textContent = "";
  optional.textContent = "";
  for (const site of SITE_LIST.filter((item) => !item.optional)) {
    builtIn.append(siteRow(site, null));
  }
  let on = 0;
  for (const site of OPTIONAL_SITES) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "switch";
    input.setAttribute("role", "switch");
    input.setAttribute("aria-label", `SafePaste on ${site.name}`);
    input.checked = await chrome.permissions.contains({ origins: originsOf(site) });
    on += input.checked ? 1 : 0;
    // Chrome shows its own "Allow SafePaste on ..." prompt; the background
    // worker then starts protecting the site, including open tabs.
    input.addEventListener("change", async () => {
      const origins = originsOf(site);
      const now = input.checked
        ? await chrome.permissions.request({ origins }).catch(() => false)
        : !(await chrome.permissions.remove({ origins }).catch(() => false));
      input.checked = now;
      if (tabSite && tabSite.id === site.id) {
        tabSiteAllowed = now;
        renderTabStatus();
      }
      renderSitesCount();
    });
    optional.append(siteRow(site, input));
  }
  renderSitesCount(on);
}

/**
 * @param {import("../shared/sites.js").SiteInfo} site
 * @param {HTMLInputElement | null} control A switch, or null for always on.
 */
function siteRow(site, control) {
  const row = document.createElement(control ? "label" : "div");
  row.className = "row plain";
  const text = document.createElement("span");
  text.className = "row-text";
  const name = document.createElement("span");
  name.className = "row-title";
  name.textContent = site.name;
  const host = document.createElement("span");
  host.className = "site-host";
  host.textContent = site.hosts[site.hosts.length - 1];
  text.append(name, host);
  row.append(text);
  if (control) {
    row.append(control);
  } else {
    const state = document.createElement("span");
    state.className = "state";
    state.textContent = "On";
    row.append(state);
  }
  return row;
}

/** @param {number} [optionalOn] */
function renderSitesCount(optionalOn) {
  const on = optionalOn ?? [...byId("optionalSites").querySelectorAll("input")].filter((input) => /** @type {HTMLInputElement} */ (input).checked).length;
  const builtIn = SITE_LIST.length - OPTIONAL_SITES.length;
  byId("sitesCount").textContent = `${builtIn + on} of ${SITE_LIST.length} on${on ? "" : ` · ${OPTIONAL_SITES.map((site) => site.name.split(" ")[0]).join(", ")} available`}`;
}

function renderCategoryControls() {
  categories.textContent = "";
  for (const group of CATEGORY_GROUPS) {
    const title = document.createElement("h2");
    title.className = "group-title";
    title.textContent = group.name;
    const list = document.createElement("div");
    list.className = "group";
    for (const [key, label] of group.categories) {
      const row = document.createElement("label");
      row.className = "row plain";
      const text = document.createElement("span");
      text.className = "row-text";
      text.textContent = label;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "switch";
      input.setAttribute("role", "switch");
      input.dataset.category = key;
      input.addEventListener("change", () => updateSettings({ categories: { ...settings.categories, [key]: input.checked } }));
      row.append(text, input);
      list.append(row);
    }
    categories.append(title, list);
  }
}

function renderSettings() {
  enabled.checked = settings.enabled;
  for (const input of sensitivityInputs) {
    input.checked = input.value === settings.sensitivity;
  }
  sensitivityHint.textContent = SENSITIVITY_HINTS[settings.sensitivity];
  placeholderStyle.value = settings.placeholderStyle;
  showToast.checked = settings.showToast;
  restoreValues.checked = settings.restoreValues;
  nameModel.checked = settings.nameModel;

  const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (categories.querySelectorAll("input[data-category]"));
  let on = 0;
  for (const checkbox of inputs) {
    checkbox.checked = Boolean(settings.categories[/** @type {Category} */ (checkbox.dataset.category)]);
    on += checkbox.checked ? 1 : 0;
  }
  typesCount.textContent = on === inputs.length ? "Everything" : `${on} of ${inputs.length} kinds of data`;
  renderTabStatus();
  renderModelStatus();
}

/** @param {Partial<import("../redactor.js").Settings>} patch */
function updateSettings(patch) {
  settings = mergeSettings({
    ...settings,
    ...patch,
    categories: {
      ...settings.categories,
      ...patch.categories
    }
  });
  chrome.storage.sync.set({ [SETTINGS_KEY]: settings }, renderSettings);
}

/**
 * @typedef {{ site?: string, timestamp?: string, findings?: { counts?: Record<string, number>, total?: number } }} RedactionSummary
 */

/** @param {RedactionSummary | undefined} summary */
function renderLastRedaction(summary) {
  lastRedaction.textContent = "";
  if (!summary) {
    lastRedaction.textContent = "Nothing hidden yet. Paste into ChatGPT, Gemini or Claude and SafePaste checks it first.";
    return;
  }
  const counts = summary.findings && summary.findings.counts ? summary.findings.counts : {};
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const line = document.createElement("div");
  line.textContent = [summary.site || "Unknown site", relativeTime(summary.timestamp), `${total} ${total === 1 ? "item" : "items"} hidden`].join(" · ");
  const list = document.createElement("div");
  list.className = "counts";
  for (const [type, count] of Object.entries(counts)) {
    const chip = document.createElement("span");
    chip.className = "count";
    chip.textContent = `${count} ${type}`;
    list.append(chip);
  }
  lastRedaction.append(line, list);
}

/** @param {string | undefined} value */
function relativeTime(value) {
  const time = value ? new Date(value).getTime() : NaN;
  if (Number.isNaN(time)) {
    return "unknown time";
  }
  const seconds = Math.round((time - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  /** @type {[Intl.RelativeTimeFormatUnit, number][]} */
  const units = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

/** @param {string} text */
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Versions before 1.0.2 stored the redacted prompt text and page URL with the
// summary. Strip those fields from records left behind by old installs.
const LEGACY_SUMMARY_FIELDS = ["redactedText", "url"];

/**
 * @param {(RedactionSummary & Record<string, unknown>) | undefined} summary
 * @returns {RedactionSummary | undefined}
 */
function sanitizeLastRedaction(summary) {
  if (!summary || !LEGACY_SUMMARY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(summary, field))) {
    return summary;
  }
  const sanitized = { ...summary };
  for (const field of LEGACY_SUMMARY_FIELDS) {
    delete sanitized[field];
  }
  chrome.storage.local.set({ [LAST_REDACTION_KEY]: sanitized });
  return sanitized;
}
