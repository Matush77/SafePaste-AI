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
 */

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
 */
export function installPasteGuard({ site, storage, win = window, doc = document, notify }) {
  const show = notify || ((message) => showToast(doc, message));

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

    const result = redact(source, settings);
    const hiddenFindings = html && !result.changed ? findHiddenSensitiveValues(html, settings) : [];
    if (!result.changed && hiddenFindings.length === 0) {
      return;
    }

    // From here on the original must not reach the page, even if insertion fails.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (dropPoint) {
      placeCaretAtPoint(editable, dropPoint.x, dropPoint.y);
    }

    let inserted;
    try {
      inserted = insertText(editable, result.text);
    } catch (_error) {
      inserted = false;
    }

    if (!inserted) {
      show("SafePaste AI blocked this paste: it contained sensitive data and the redacted text could not be inserted. Nothing was pasted.");
      return;
    }

    const findings = result.changed ? result.findings : hiddenFindings;
    if (settings.showToast) {
      show(result.changed
        ? `SafePaste AI: redacted ${plural(findings.length, "item")}.`
        : `SafePaste AI: pasted as plain text because links or formatting contained ${plural(findings.length, "sensitive item")}.`);
    }

    storage.local.set({
      [LAST_REDACTION_KEY]: {
        site: site.name,
        timestamp: new Date().toISOString(),
        findings: summarizeFindings(findings)
      }
    }).catch(() => {});
  }

  return {
    ready,
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
function showToast(doc, message) {
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
