import { mergeSettings } from "../redactor.js";
import { MESSAGES, NAME_MODEL_SIZE_MB } from "../shared/nameModel.js";
import { LAST_REDACTION_KEY, SETTINGS_KEY } from "../shared/storageKeys.js";
import { SUPPORTED_SITE_NAMES, siteForHostname } from "../siteAdapters.js";

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
        <dt>Where it is kept</dt><dd>In this browser's cache for SafePaste. Turning the feature off keeps it, so turning it on again is instant. Removing the extension deletes it.</dd>
        <dt>If it fails</dt><dd>If it cannot load or answer in time, pastes are still redacted with the built-in rules, and you are told.</dd>
      </dl>`
  }
};

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

let settings = mergeSettings();
/** @type {import("../siteAdapters.js").Site | null} */
let tabSite = null;
/** @type {NameModelStatus | null} */
let modelStatus = null;

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
  // The URL is only visible for tabs on the supported sites (the extension's
  // host permissions), which is all the status line needs.
  chrome.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      tabSite = tab && tab.url ? siteForHostname(new URL(tab.url).hostname) : null;
      renderTabStatus();
    })
    .catch(() => renderTabStatus());

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
      body: `${modelFacts()}<p>It finds names the built-in rules miss. The download starts now and can take a minute or two; you can keep working meanwhile and turn it off any time.</p>`,
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
    button.addEventListener("click", () => {
      const info = INFO[/** @type {keyof typeof INFO} */ (/** @type {HTMLElement} */ (button).dataset.info)];
      const error = button.getAttribute("data-info") === "model" && modelStatus && modelStatus.state === "error"
        ? `<p class="error-detail">Last error: ${escapeHtml(modelStatus.error || "unknown")}</p>` : "";
      openSheet({ title: info.title, body: info.body + error, primary: "Got it", opener: /** @type {HTMLElement} */ (button) });
    });
  }

  byId("openTypes").addEventListener("click", () => showTypes(true));
  byId("closeTypes").addEventListener("click", () => showTypes(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("sheet").hidden) {
      closeSheet();
    } else if (event.key === "Escape" && !typesView.hidden) {
      showTypes(false);
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
    <li><span>Download</span><b>about ${NAME_MODEL_SIZE_MB} MB, once</b></li>
    <li><span>From</span><b>Hugging Face (huggingface.co)</b></li>
    <li><span>Runs</span><b>on this device</b></li>
    <li><span>Pasted text</span><b>never leaves your browser</b></li>
    <li><span>Checked</span><b>fixed version, SHA-256 verified</b></li>
  </ul>`;
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
    nameModelStatus.textContent = "";
    return;
  }
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
 * @param {{ title: string, body: string, primary: string, secondary?: string, opener: HTMLElement, onPrimary?: () => void }} options
 */
function openSheet({ title, body, primary, secondary, opener, onPrimary }) {
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
  secondaryButton.onclick = closeSheet;
  layer.onclick = (event) => {
    if (event.target === layer) {
      closeSheet();
    }
  };
  layer.hidden = false;
  /** @type {any} */ (layer).opener = opener;
  for (const view of [homeView, typesView]) {
    view.inert = true;
  }
  primaryButton.focus();
}

function closeSheet() {
  const layer = byId("sheet");
  layer.hidden = true;
  const typesOpen = !typesView.hidden;
  homeView.inert = typesOpen;
  typesView.inert = !typesOpen;
  const opener = /** @type {any} */ (layer).opener;
  if (opener) {
    opener.focus();
  }
}

/** @param {boolean} show */
function showTypes(show) {
  if (show) {
    typesView.hidden = false;
    typesView.inert = false;
    homeView.inert = true;
    requestAnimationFrame(() => {
      typesView.classList.add("here");
      homeView.classList.add("away");
      /** @type {HTMLElement} */ (byId("closeTypes")).focus();
    });
  } else {
    typesView.classList.remove("here");
    homeView.classList.remove("away");
    homeView.inert = false;
    typesView.inert = true;
    setTimeout(() => {
      typesView.hidden = true;
    }, 230);
    byId("openTypes").focus();
  }
}

function renderTabStatus() {
  tabStatus.className = "status";
  if (!settings.enabled) {
    tabStatus.classList.add("paused");
    tabStatus.textContent = "Paused · pastes are not checked";
  } else if (tabSite) {
    tabStatus.classList.add("on");
    tabStatus.textContent = `Protecting this tab · ${tabSite.name}`;
  } else {
    tabStatus.textContent = `Works on ${SUPPORTED_SITE_NAMES.join(", ")}`;
  }
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
