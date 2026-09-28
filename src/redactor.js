// Public API of the redaction engine: settings, detect() and redact().
// Everything here is pure (no DOM, no chrome.* APIs), so it runs the same in
// the content script, the popup, and Node tests. Detection rules live in
// src/detection/.

import { detectAll } from "./detection/index.js";

/**
 * @typedef {"apiKeys"|"credentials"|"emails"|"phones"|"financial"|"governmentIds"|"network"|"addresses"|"people"|"organizations"|"locations"|"urls"} Category
 *
 * @typedef {object} Settings
 * @property {boolean} enabled
 * @property {boolean} showToast
 * @property {"typed"|"compact"} placeholderStyle
 * @property {"balanced"|"strict"} sensitivity  "strict" also redacts low-confidence matches.
 * @property {Record<Category, boolean>} categories
 *
 * @typedef {object} Match
 * @property {number} start
 * @property {number} end
 * @property {string} value
 * @property {string} type
 * @property {Category} category
 *
 * @typedef {object} Finding
 * @property {Category} category
 * @property {string} type
 * @property {string} placeholder
 * @property {number} start  Offset of the redacted value in the original text.
 * @property {number} end
 *
 * @typedef {object} RedactionResult
 * @property {string} text
 * @property {boolean} changed
 * @property {Finding[]} findings
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  showToast: true,
  placeholderStyle: "typed",
  sensitivity: "balanced",
  categories: {
    apiKeys: true,
    credentials: true,
    emails: true,
    phones: true,
    financial: true,
    governmentIds: true,
    network: true,
    addresses: true,
    people: true,
    organizations: true,
    locations: true,
    urls: false
  }
});

/** @type {Record<Category, string>} */
export const CATEGORY_LABELS = {
  apiKeys: "API_KEY",
  credentials: "CREDENTIAL",
  emails: "EMAIL",
  phones: "PHONE",
  financial: "FINANCIAL",
  governmentIds: "GOV_ID",
  network: "NETWORK",
  addresses: "ADDRESS",
  people: "PERSON",
  organizations: "ORG",
  locations: "LOCATION",
  urls: "URL"
};

/**
 * Fills in defaults for anything missing or malformed in stored settings.
 * @param {Partial<Settings> | null | undefined} [settings]
 * @returns {Settings}
 */
export function mergeSettings(settings) {
  const input = settings && typeof settings === "object" ? settings : {};
  /** @type {Record<string, boolean>} */
  const categories = { ...DEFAULT_SETTINGS.categories };
  for (const [key, value] of Object.entries(input.categories || {})) {
    if (key in categories && typeof value === "boolean") {
      categories[key] = value;
    }
  }

  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_SETTINGS.enabled,
    showToast: typeof input.showToast === "boolean" ? input.showToast : DEFAULT_SETTINGS.showToast,
    placeholderStyle: input.placeholderStyle === "compact" ? "compact" : "typed",
    sensitivity: input.sensitivity === "strict" ? "strict" : "balanced",
    categories: /** @type {Record<Category, boolean>} */ (categories)
  };
}

/**
 * Returns the non-overlapping sensitive spans found in `text`, ignoring
 * whether redaction is enabled. Used by redact() and by the evaluation suite.
 * @param {string} text
 * @param {Partial<Settings>} [settingsInput]
 * @param {import("./detection/util.js").Candidate[]} [extra] Extra candidates, e.g. from the NER model.
 * @returns {Match[]}
 */
export function detect(text, settingsInput, extra) {
  if (!text) {
    return [];
  }
  return detectAll(text, mergeSettings(settingsInput), extra);
}

/**
 * @param {string} text
 * @param {Partial<Settings>} [settingsInput]
 * @param {import("./detection/util.js").Candidate[]} [extra]
 * @returns {RedactionResult}
 */
export function redact(text, settingsInput, extra) {
  const settings = mergeSettings(settingsInput);
  if (!text || !settings.enabled) {
    return { text, changed: false, findings: [] };
  }

  const matches = detectAll(text, settings, extra);
  if (matches.length === 0) {
    return { text, changed: false, findings: [] };
  }

  const placeholderFor = createPlaceholderFactory(settings);
  let output = "";
  let cursor = 0;
  /** @type {Finding[]} */
  const findings = [];

  for (const match of matches) {
    output += text.slice(cursor, match.start);
    const label = match.type || CATEGORY_LABELS[match.category] || "REDACTED";
    const placeholder = placeholderFor(label, match.value);
    output += placeholder;
    cursor = match.end;
    findings.push({ category: match.category, type: label, placeholder, start: match.start, end: match.end });
  }
  output += text.slice(cursor);

  return { text: output, changed: output !== text, findings };
}

/**
 * The same value always gets the same placeholder within one redaction.
 * @param {Settings} settings
 * @returns {(type: string, value: string) => string}
 */
function createPlaceholderFactory(settings) {
  /** @type {Map<string, number>} */
  const counters = new Map();
  /** @type {Map<string, string>} */
  const values = new Map();

  return function placeholderFor(type, value) {
    const key = `${type}\u0000${value}`;
    const existing = values.get(key);
    if (existing) {
      return existing;
    }

    const count = (counters.get(type) || 0) + 1;
    counters.set(type, count);
    const placeholder = settings.placeholderStyle === "compact" ? `[${type}_${count}]` : `[[${type}_${count}]]`;
    values.set(key, placeholder);
    return placeholder;
  };
}
