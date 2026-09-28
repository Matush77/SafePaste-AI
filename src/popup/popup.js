import { mergeSettings } from "../redactor.js";
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
const showToast = /** @type {HTMLInputElement} */ (document.getElementById("showToast"));
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
  showToast.addEventListener("change", () => updateSettings({ showToast: showToast.checked }));
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
  showToast.checked = settings.showToast;

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
