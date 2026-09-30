import { mergeSettings } from "../redactor.js";
import { MESSAGES, NAME_MODEL_SIZE_MB } from "../shared/nameModel.js";
import { LAST_REDACTION_KEY, SETTINGS_KEY } from "../shared/storageKeys.js";
import { SUPPORTED_SITE_NAMES, siteForHostname } from "../siteAdapters.js";

/** @typedef {import("../redactor.js").Category} Category */

/** @type {{ name: string, categories: [Category, string][] }[]} */
const CATEGORY_GROUPS = [
  { name: "Secrets", categories: [["apiKeys", "API keys"], ["credentials", "Passwords"]] },
  { name: "Contact", categories: [["emails", "Emails"], ["phones", "Phones"], ["addresses", "Addresses"]] },
  { name: "Money and IDs", categories: [["financial", "Cards & IBANs"], ["governmentIds", "Government IDs"]] },
  { name: "People and places", categories: [["people", "Names"], ["organizations", "Organizations"], ["locations", "Places"]] },
  { name: "Technical", categories: [["network", "IP & MAC"], ["urls", "URLs"]] }
];

const SENSITIVITY_HINTS = {
  balanced: "Redacts confident matches. Fewest false alarms.",
  strict: "Also redacts likely matches, such as random-looking strings and place names on their own."
};

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const enabled = /** @type {HTMLInputElement} */ (byId("enabled"));
const tabStatus = byId("tabStatus");
const sensitivityInputs = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll("input[name='sensitivity']"));
const sensitivityHint = byId("sensitivityHint");
const nameModel = /** @type {HTMLInputElement} */ (byId("nameModel"));
const nameModelStatus = byId("nameModelStatus");
const categories = byId("categories");
const typesCount = byId("typesCount");
const placeholderStyle = /** @type {HTMLSelectElement} */ (byId("placeholderStyle"));
const showToast = /** @type {HTMLInputElement} */ (byId("showToast"));
const lastRedaction = byId("lastRedaction");

let settings = mergeSettings();
/** @type {import("../siteAdapters.js").Site | null} */
let tabSite = null;

init();

function init() {
  renderCategoryControls();
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
  const infoToggle = byId("nameModelInfoToggle");
  const info = byId("nameModelInfo");
  infoToggle.addEventListener("click", () => {
    info.hidden = !info.hidden;
    infoToggle.setAttribute("aria-expanded", String(!info.hidden));
  });

  nameModel.addEventListener("change", () => {
    updateSettings({ nameModel: nameModel.checked });
    if (nameModel.checked) {
      requestModel(MESSAGES.prepare);
    } else {
      renderModelStatus(null);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === MESSAGES.progress && settings.nameModel) {
      renderModelStatus(message.status);
    }
  });
  requestModel(MESSAGES.status);
}

/** @param {string} type */
function requestModel(type) {
  chrome.runtime.sendMessage({ type })
    .then((response) => {
      if (settings.nameModel || type === MESSAGES.prepare) {
        renderModelStatus(response && response.status ? response.status : { state: "error", error: response && response.error });
      }
    })
    .catch((error) => renderModelStatus({ state: "error", error: String(error) }));
}

/** @param {import("../shared/nameModel.js").NameModelStatus | null} status */
function renderModelStatus(status) {
  nameModelStatus.textContent = "";
  if (!status || !nameModel.checked) {
    return;
  }
  const pill = document.createElement("span");
  pill.className = "pill";
  switch (status.state) {
    case "ready":
      pill.classList.add("ok");
      pill.textContent = "Ready · runs on this device";
      break;
    case "downloaded":
      pill.classList.add("ok");
      pill.textContent = "Downloaded · loads on your next paste";
      break;
    case "absent":
      pill.textContent = `Not downloaded yet (about ${NAME_MODEL_SIZE_MB} MB)`;
      break;
    case "loading":
      pill.textContent = "Loading the model…";
      break;
    case "downloading": {
      const progress = Math.max(0, Math.min(100, Math.round(status.progress ?? 0)));
      pill.textContent = `Downloading… ${progress}%`;
      const bar = document.createElement("div");
      bar.className = "progress";
      const fill = document.createElement("div");
      fill.style.width = `${progress}%`;
      bar.append(fill);
      nameModelStatus.append(pill, bar);
      return;
    }
    default:
      pill.classList.add("error");
      pill.textContent = `The model could not be loaded: ${status.error || "unknown error"}. Pastes are still redacted with the built-in rules.`;
  }
  nameModelStatus.append(pill);
}

function renderTabStatus() {
  tabStatus.className = "status";
  if (!settings.enabled) {
    tabStatus.classList.add("paused");
    tabStatus.textContent = "Paused: pastes are not checked";
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
    const heading = document.createElement("div");
    heading.className = "group";
    heading.textContent = group.name;
    categories.append(heading);

    for (const [key, label] of group.categories) {
      const chip = document.createElement("label");
      chip.className = "chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.category = key;
      input.addEventListener("change", () => {
        updateSettings({ categories: { ...settings.categories, [key]: input.checked } });
      });
      chip.append(input, label);
      categories.append(chip);
    }
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
  nameModel.checked = settings.nameModel;

  const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (categories.querySelectorAll("input[data-category]"));
  let on = 0;
  for (const checkbox of inputs) {
    checkbox.checked = Boolean(settings.categories[/** @type {Category} */ (checkbox.dataset.category)]);
    on += checkbox.checked ? 1 : 0;
  }
  typesCount.textContent = `${on} of ${inputs.length} on`;
  renderTabStatus();
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
    lastRedaction.textContent = "Nothing redacted yet.";
    return;
  }

  const counts = summary.findings && summary.findings.counts ? summary.findings.counts : {};
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const line = document.createElement("div");
  line.textContent = [summary.site || "Unknown site", relativeTime(summary.timestamp), `${total} ${total === 1 ? "item" : "items"} redacted`].join(" · ");
  lastRedaction.append(line);

  const list = document.createElement("div");
  list.className = "counts";
  for (const [type, count] of Object.entries(counts)) {
    const chip = document.createElement("span");
    chip.className = "count";
    chip.textContent = `${count} ${type}`;
    list.append(chip);
  }
  lastRedaction.append(list);
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
