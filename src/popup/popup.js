import { mergeSettings } from "../redactor.js";
import { MESSAGES, NAME_MODEL_SIZE_MB } from "../shared/nameModel.js";
import { LAST_REDACTION_KEY, SETTINGS_KEY } from "../shared/storageKeys.js";

/** @type {Record<import("../redactor.js").Category, string>} */
const CATEGORY_NAMES = {
  apiKeys: "API keys and tokens",
  credentials: "Credentials in key/value text",
  emails: "Email addresses",
  phones: "Phone numbers",
  financial: "Credit cards and IBANs",
  governmentIds: "Government IDs",
  network: "IP and MAC addresses",
  addresses: "Street addresses",
  people: "People names",
  organizations: "Organizations",
  locations: "Locations",
  urls: "URLs"
};

const enabled = /** @type {HTMLInputElement} */ (document.getElementById("enabled"));
const categories = /** @type {HTMLElement} */ (document.getElementById("categories"));
const placeholderStyle = /** @type {HTMLSelectElement} */ (document.getElementById("placeholderStyle"));
const sensitivity = /** @type {HTMLSelectElement} */ (document.getElementById("sensitivity"));
const showToast = /** @type {HTMLInputElement} */ (document.getElementById("showToast"));
const nameModel = /** @type {HTMLInputElement} */ (document.getElementById("nameModel"));
const nameModelStatus = /** @type {HTMLElement} */ (document.getElementById("nameModelStatus"));
const lastRedaction = /** @type {HTMLElement} */ (document.getElementById("lastRedaction"));

let settings = mergeSettings();

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

  enabled.addEventListener("change", () => updateSettings({ enabled: enabled.checked }));
  placeholderStyle.addEventListener("change", () => updateSettings({ placeholderStyle: /** @type {"typed" | "compact"} */ (placeholderStyle.value) }));
  sensitivity.addEventListener("change", () => updateSettings({ sensitivity: /** @type {"balanced" | "strict"} */ (sensitivity.value) }));
  showToast.addEventListener("change", () => updateSettings({ showToast: showToast.checked }));
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
  if (!status || !nameModel.checked) {
    nameModelStatus.textContent = "";
    return;
  }
  const text = {
    absent: `Not downloaded yet (about ${NAME_MODEL_SIZE_MB} MB).`,
    downloaded: "Downloaded. Loads when you next paste on a supported site.",
    downloading: `Downloading the model… ${status.progress ?? 0}%`,
    loading: "Loading the model…",
    ready: "Ready. Names are checked on this device.",
    error: `The model could not be loaded: ${status.error || "unknown error"}. Pastes are still redacted with the built-in rules.`
  }[status.state];
  nameModelStatus.textContent = text;
}

function renderCategoryControls() {
  categories.textContent = "";
  for (const [key, label] of Object.entries(CATEGORY_NAMES)) {
    const row = document.createElement("label");
    row.className = "toggle";

    const text = document.createElement("span");
    text.textContent = label;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.category = key;
    input.addEventListener("change", () => {
      updateSettings({
        categories: {
          ...settings.categories,
          [key]: input.checked
        }
      });
    });

    row.append(text, input);
    categories.append(row);
  }
}

function renderSettings() {
  enabled.checked = settings.enabled;
  placeholderStyle.value = settings.placeholderStyle;
  sensitivity.value = settings.sensitivity;
  showToast.checked = settings.showToast;
  nameModel.checked = settings.nameModel;

  for (const input of categories.querySelectorAll("input[data-category]")) {
    const checkbox = /** @type {HTMLInputElement} */ (input);
    const category = /** @type {import("../redactor.js").Category} */ (checkbox.dataset.category);
    checkbox.checked = Boolean(settings.categories[category]);
  }
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
  if (!summary) {
    lastRedaction.textContent = "No redactions yet.";
    return;
  }

  const counts = summary.findings && summary.findings.counts ? summary.findings.counts : {};
  const countText = Object.entries(counts)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");

  lastRedaction.innerHTML = "";
  const top = document.createElement("div");
  top.textContent = `${summary.site || "Site"} at ${formatTime(summary.timestamp)}`;
  const bottom = document.createElement("div");
  bottom.className = "muted";
  bottom.textContent = countText || "No sensitive text found.";
  lastRedaction.append(top, bottom);
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

/** @param {string | undefined} value */
function formatTime(value) {
  if (!value) {
    return "unknown time";
  }
  return new Date(value).toLocaleString();
}
