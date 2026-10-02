// Intercepts paste and drop into a supported site's prompt editor and inserts
// a redacted copy instead. Safety rule: when in doubt, redact or block, never
// let the original text through silently.

import { mergeSettings, redact } from "./redactor.js";
import { insertText, placeCaretAtPoint, promptEditableFromEvent } from "./siteAdapters.js";
import { LAST_REDACTION_KEY, SETTINGS_KEY } from "./shared/storageKeys.js";

/**
 * @typedef {import("./redactor.js").Settings} Settings
 * @typedef {import("./redactor.js").Finding} Finding
 * @typedef {import("./siteAdapters.js").Site} Site
 *
 * @typedef {object} StorageArea
 * @property {(key: string) => Promise<Record<string, any>>} get
 * @property {(items: Record<string, any>) => Promise<void>} set
 *
 * @typedef {object} Storage
 * @property {StorageArea} sync
 * @property {StorageArea} local
 * @property {{ addListener: (listener: (changes: Record<string, { newValue?: any }>, areaName: string) => void) => void }} onChanged
 *
 * @typedef {(message: string) => void} Notify
 *
 * @typedef {import("./detection/util.js").Candidate} Candidate
 * @typedef {{ detect: (text: string) => Promise<Candidate[]> }} NameModel
 */

// Longer pastes use the rules only; the model would keep the user waiting.
const NAME_MODEL_MAX_CHARS = 30000;
// How long a paste may wait for the model before falling back to the rules.
const NAME_MODEL_BASE_WAIT_MS = 3000;
const NAME_MODEL_WAIT_MS_PER_CHAR = 0.4;
const NAME_MODEL_MAX_WAIT_MS = 15000;

// Attributes that can carry a sensitive value that is not part of the
// visible text, e.g. <a href="https://example.com/reset?token=...">Reset</a>.
const HIDDEN_VALUE_ATTRIBUTES = ["href", "src", "title", "alt"];

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "DL", "DT", "DD", "FIGCAPTION", "FOOTER", "H1", "H2", "H3",
  "H4", "H5", "H6", "HEADER", "HR", "LI", "OL", "P", "PRE", "SECTION", "TABLE", "TR", "UL"
]);

/**
 * @param {object} options
 * @param {Site} options.site
 * @param {Storage} options.storage
 * @param {Window} [options.win]
 * @param {Document} [options.doc]
 * @param {Notify} [options.notify]
 * @param {NameModel} [options.nameModel] The optional local name-detection model.
 * @param {import("./vault.js").Vault} [options.vault] Numbers placeholders across pastes and remembers their values.
 * @param {(editable: HTMLElement) => void} [options.onRedacted] Called after a redacted paste is inserted; when set, it
 *   replaces the "redacted N items" notice (the review chip shows it instead).
 */
export function installPasteGuard({ site, storage, win = window, doc = document, notify, nameModel, vault, onRedacted }) {
  const show = notify || ((message) => showToast(doc, message));
  const placeholders = () => (vault ? { placeholderFor: (/** @type {string} */ type, /** @type {string} */ value) => vault.placeholderFor(type, value, settings.placeholderStyle) } : {});
  /** @type {Promise<void>} */
  let pending = Promise.resolve();

  // Start from the defaults (redaction on) rather than "disabled until settings
  // load": a paste during page load, or a storage failure, must not leak.
  let settings = mergeSettings();
  let internalDrag = false;

  const ready = storage.sync.get(SETTINGS_KEY)
    .then((items) => {
      settings = mergeSettings(items && items[SETTINGS_KEY]);
    })
    .catch(() => {
      // Keep the defaults.
    });

  storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[SETTINGS_KEY]) {
      settings = mergeSettings(changes[SETTINGS_KEY].newValue);
    }
  });

  // Text dragged within the page is already in the page; redacting it on
  // drop would leave the original in place and insert a second copy.
  const onDragStart = () => { internalDrag = true; };
  const onDragEnd = () => { internalDrag = false; };

  // Capture on window so this runs before the page's own handlers.
  /** @type {[string, (event: any) => void][]} */
  const listeners = [["paste", onPaste], ["drop", onDrop], ["dragstart", onDragStart], ["dragend", onDragEnd]];
  for (const [type, listener] of listeners) {
    win.addEventListener(type, listener, true);
  }

  /** @param {ClipboardEvent} event */
  function onPaste(event) {
    handleTransfer(event, event.clipboardData, null);
  }

  /** @param {DragEvent} event */
  function onDrop(event) {
    if (internalDrag) {
      internalDrag = false;
      return;
    }
    handleTransfer(event, event.dataTransfer, { x: event.clientX, y: event.clientY });
  }

  /**
   * @param {Event} event
   * @param {DataTransfer | null} data
   * @param {{ x: number, y: number } | null} dropPoint
   */
  function handleTransfer(event, data, dropPoint) {
    if (!settings.enabled || !data) {
      return;
    }

    const editable = promptEditableFromEvent(event, site);
    if (!editable) {
      return;
    }

    const plain = data.getData("text/plain");
    const html = editable.tagName === "TEXTAREA" ? "" : data.getData("text/html");
    const source = plain || (html ? htmlToText(html) : "");
    if (!source) {
      return;
    }

    const rules = redact(source, settings, undefined, placeholders());
    const hiddenFindings = html && !rules.changed ? findHiddenSensitiveValues(html, settings) : [];
    const useModel = Boolean(settings.nameModel && nameModel && source.length <= NAME_MODEL_MAX_CHARS);
    // Without the model, a paste with nothing to redact goes through untouched.
    // With it, the answer is not known yet, so every paste is held.
    if (!useModel && !rules.changed && hiddenFindings.length === 0) {
      return;
    }

    // From here on the original must not reach the page, even if insertion fails.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (dropPoint) {
      placeCaretAtPoint(editable, dropPoint.x, dropPoint.y);
    }

    if (!useModel) {
      finish(editable, source, rules, hiddenFindings, false);
      return;
    }

    // Keep pastes in order while each waits for the model.
    pending = pending.then(async () => {
      const candidates = await detectNamesWithTimeout(source);
      const result = candidates ? redact(source, settings, candidates, placeholders()) : rules;
      finish(editable, source, result, hiddenFindings, !candidates);
    });
  }

  /**
   * @param {HTMLElement} editable
   * @param {string} source
   * @param {import("./redactor.js").RedactionResult} result
   * @param {Finding[]} hiddenFindings
   * @param {boolean} modelFailed
   */
  function finish(editable, source, result, hiddenFindings, modelFailed) {
    let inserted;
    try {
      inserted = insertText(editable, result.changed ? result.text : source);
    } catch (_error) {
      inserted = false;
    }

    if (!inserted) {
      show("SafePaste AI blocked this paste: the redacted text could not be inserted. Nothing was pasted.");
      return;
    }

    const findings = result.changed ? result.findings : hiddenFindings;
    if (result.changed && onRedacted) {
      onRedacted(editable);
    }
    if (settings.showToast || modelFailed) {
      const fallback = modelFailed ? " The name model did not respond, so only the built-in rules were used." : "";
      if (result.changed) {
        // With the review chip, it shows what was hidden; a notice is only
        // needed to say the name model did not answer.
        if (!onRedacted || modelFailed) {
          show(`SafePaste AI: redacted ${plural(findings.length, "item")}.${fallback}`);
        }
      } else if (findings.length) {
        show(`SafePaste AI: pasted as plain text because links or formatting contained ${plural(findings.length, "sensitive item")}.${fallback}`);
      } else if (modelFailed) {
        show(`SafePaste AI: nothing to redact.${fallback}`);
      }
    }

    if (findings.length) {
      storage.local.set({
        [LAST_REDACTION_KEY]: {
          site: site.name,
          timestamp: new Date().toISOString(),
          findings: summarizeFindings(findings)
        }
      }).catch(() => {});
    }
  }

  /**
   * Names from the local model, or null if it failed or took too long.
   * @param {string} text
   * @returns {Promise<Candidate[] | null>}
   */
  async function detectNamesWithTimeout(text) {
    const limit = Math.min(NAME_MODEL_MAX_WAIT_MS, NAME_MODEL_BASE_WAIT_MS + text.length * NAME_MODEL_WAIT_MS_PER_CHAR);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const slowNotice = setTimeout(() => show("SafePaste AI: checking for names…"), 600);
    try {
      return await Promise.race([
        /** @type {NameModel} */ (nameModel).detect(text).catch(() => null),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), limit);
        })
      ]);
    } finally {
      clearTimeout(timer);
      clearTimeout(slowNotice);
    }
  }

  return {
    ready,
    /** The current settings. */
    settings: () => settings,
    /** Resolves once every held paste has been inserted. */
    whenIdle: () => pending,
    dispose() {
      for (const [type, listener] of listeners) {
        win.removeEventListener(type, listener, true);
      }
    }
  };
}

/**
 * Plain-text rendering of clipboard HTML, keeping line breaks between blocks.
 * @param {string} html
 */
export function htmlToText(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  let text = "";
  /** @param {Node} node */
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const tag = /** @type {Element} */ (node).tagName;
    if (tag === "SCRIPT" || tag === "STYLE") {
      return;
    }
    if (tag === "BR") {
      text += "\n";
      return;
    }
    node.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(tag) && !text.endsWith("\n")) {
      text += "\n";
    }
  };
  walk(parsed.body);
  return text.replace(/\n+$/, "");
}

/**
 * @param {string} html
 * @param {Settings} settings
 * @returns {Finding[]}
 */
function findHiddenSensitiveValues(html, settings) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const values = [];
  for (const element of parsed.body.querySelectorAll("*")) {
    for (const name of HIDDEN_VALUE_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) {
        values.push(decodeURIComponentSafe(value.replace(/^mailto:|^tel:/i, "")));
      }
    }
  }
  return values.length ? redact(values.join("\n"), settings).findings : [];
}

/** @param {string} value */
function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

/** @param {Finding[]} findings */
function summarizeFindings(findings) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const finding of findings) {
    counts[finding.type] = (counts[finding.type] || 0) + 1;
  }
  return { counts, total: findings.length };
}

/**
 * @param {number} count
 * @param {string} noun
 */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Short on-page notice. Contains counts only, never prompt text.
 * @param {Document} doc
 * @param {string} message
 */
export function showToast(doc, message) {
  if (!doc.body) {
    return;
  }

  const container = doc.createElement("div");
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
  container.textContent = message;
  Object.assign(container.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    background: "#172033",
    color: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
    font: "13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    maxWidth: "320px",
    padding: "10px 12px",
    pointerEvents: "none"
  });

  doc.body.append(container);
  setTimeout(() => container.remove(), 4000);
}
