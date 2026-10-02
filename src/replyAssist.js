// Helps with replies that contain SafePaste placeholders, without ever
// writing a real value into the site's page (its scripts, analytics and
// session recorders can read the page, so that would leak the value):
// - placeholders SafePaste created are highlighted with the CSS Custom
//   Highlight API, which styles text without changing the page;
// - hovering one shows its real value in a closed shadow root, which page
//   scripts cannot read;
// - copying a selection puts the text on the clipboard with real values;
// - copyLastReply() does the same for the newest reply.

import { knowsReplyLayout, lastReply } from "./siteAdapters.js";

/**
 * @typedef {import("./vault.js").Vault} Vault
 * @typedef {import("./vault.js").VaultEntry} VaultEntry
 * @typedef {import("./siteAdapters.js").Site} Site
 * @typedef {{ node: Text, start: number, end: number, entry: VaultEntry }} Occurrence
 */

const HIGHLIGHT_NAME = "safepaste-placeholder";
// Placeholders are written in capitals with an underscore and a number.
const MAY_CONTAIN_PLACEHOLDER = /[A-Z]_\d/;
const SCAN_DELAY_MS = 150;

/**
 * @param {object} options
 * @param {Vault} options.vault
 * @param {Site} options.site
 * @param {() => boolean} options.isEnabled
 * @param {(message: string) => void} options.notify
 * @param {() => void} [options.onChange] Called when the placeholders in replies change.
 * @param {Document} [options.doc]
 * @param {Window} [options.win]
 */
export function installReplyAssist({ vault, site, isEnabled, notify, onChange = () => {}, doc = document, win = window }) {
  /** @type {Map<Text, Occurrence[]>} */
  const occurrences = new Map();
  const highlight = createHighlight(doc, win);
  /** @type {MutationObserver | null} */
  let observer = null;
  /** @type {Set<Node>} */
  const dirty = new Set();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let scanTimer;
  const peek = createPeek(doc);

  /** Starts watching the page; called once something has been hidden. */
  function activate() {
    if (observer || !doc.body) {
      return;
    }
    const watcher = new MutationObserver((records) => {
      for (const record of records) {
        dirty.add(record.target);
        record.addedNodes.forEach((node) => dirty.add(node));
      }
      scheduleScan();
    });
    watcher.observe(doc.body, { subtree: true, childList: true, characterData: true });
    observer = watcher;
    dirty.add(doc.body);
    scheduleScan();
    win.addEventListener("copy", onCopy, true);
    doc.addEventListener("mousemove", onMouseMove, { passive: true });
  }

  function scheduleScan() {
    if (scanTimer === undefined) {
      scanTimer = setTimeout(() => {
        scanTimer = undefined;
        scan();
      }, SCAN_DELAY_MS);
    }
  }

  /** Re-reads the placeholders in changed parts of the page. */
  function scan() {
    const roots = [...dirty];
    dirty.clear();
    for (const root of roots) {
      if (root.nodeType === Node.TEXT_NODE) {
        scanText(/** @type {Text} */ (root));
        continue;
      }
      if (root.nodeType !== Node.ELEMENT_NODE || !root.isConnected) {
        continue;
      }
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        scanText(/** @type {Text} */ (node));
      }
    }
    for (const node of occurrences.keys()) {
      if (!node.isConnected) {
        occurrences.delete(node);
      }
    }
    redraw();
    onChange();
  }

  /** @param {Text} node */
  function scanText(node) {
    const text = node.nodeValue || "";
    const parent = node.parentElement;
    if (!MAY_CONTAIN_PLACEHOLDER.test(text) || !parent || isEditableOrOurs(parent)) {
      occurrences.delete(node);
      return;
    }
    const found = vault.find(text).map(({ start, end, entry }) => ({ node, start, end, entry }));
    if (found.length) {
      occurrences.set(node, found);
    } else {
      occurrences.delete(node);
    }
  }

  function redraw() {
    if (!highlight) {
      return;
    }
    highlight.clear();
    if (!isEnabled()) {
      return;
    }
    for (const list of occurrences.values()) {
      for (const occurrence of list) {
        const range = doc.createRange();
        try {
          range.setStart(occurrence.node, occurrence.start);
          range.setEnd(occurrence.node, occurrence.end);
          highlight.add(range);
        } catch (_error) {
          // The text changed since the scan; the next scan fixes it.
        }
      }
    }
  }

  /** @param {MouseEvent} event */
  function onMouseMove(event) {
    if (!isEnabled() || !occurrences.size) {
      peek.hide();
      return;
    }
    const caret = typeof doc.caretRangeFromPoint === "function" ? doc.caretRangeFromPoint(event.clientX, event.clientY) : null;
    const node = caret && caret.startContainer;
    const list = node && node.nodeType === Node.TEXT_NODE ? occurrences.get(/** @type {Text} */ (node)) : undefined;
    const occurrence = list && list.find((item) => caret && caret.startOffset >= item.start && caret.startOffset <= item.end);
    if (!occurrence) {
      peek.hide();
      return;
    }
    const range = doc.createRange();
    range.setStart(occurrence.node, occurrence.start);
    range.setEnd(occurrence.node, Math.min(occurrence.end, (occurrence.node.nodeValue || "").length));
    peek.show(occurrence.entry, range.getBoundingClientRect());
  }

  /** @param {ClipboardEvent} event */
  function onCopy(event) {
    if (!isEnabled() || !event.clipboardData) {
      return;
    }
    const selection = doc.getSelection();
    const anchor = selection && selection.anchorNode;
    const anchorElement = anchor && (anchor.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (anchor) : anchor.parentElement);
    // Text copied out of the prompt box stays as it will be sent.
    if (!selection || !anchorElement || isEditableOrOurs(anchorElement)) {
      return;
    }
    const text = selection.toString();
    const count = vault.find(text).length;
    if (!count) {
      return;
    }
    event.clipboardData.setData("text/plain", vault.restore(text));
    event.preventDefault();
    notify(`SafePaste AI: copied with ${count === 1 ? "the real value" : `${count} real values`} filled back in.`);
  }

  return {
    activate,

    /** How many placeholders are in replies on the page. */
    count() {
      let total = 0;
      for (const list of occurrences.values()) {
        total += list.length;
      }
      return total;
    },

    /** Whether "Copy reply with real values" can find this site's replies. */
    canCopyLastReply() {
      return knowsReplyLayout(site);
    },

    /** The newest reply's text with real values, or null. */
    lastReplyText() {
      const reply = lastReply(site, doc);
      const text = reply ? reply.innerText || reply.textContent || "" : "";
      return text && vault.find(text).length ? vault.restore(text) : null;
    },

    refresh() {
      redraw();
      onChange();
    }
  };
}

/**
 * @param {Element} element
 */
function isEditableOrOurs(element) {
  return Boolean(element.closest("[contenteditable='true'], [contenteditable=''], textarea, input, safepaste-ui"));
}

/**
 * @param {Document} doc
 * @param {Window} win
 * @returns {{ add: (range: Range) => void, clear: () => void } | null}
 */
function createHighlight(doc, win) {
  const HighlightClass = /** @type {any} */ (win).Highlight;
  const registry = /** @type {any} */ (win).CSS && /** @type {any} */ (win).CSS.highlights;
  if (!HighlightClass || !registry) {
    return null;
  }
  const highlight = new HighlightClass();
  registry.set(HIGHLIGHT_NAME, highlight);
  const style = doc.createElement("style");
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(52, 211, 153, 0.28); text-decoration: underline dotted rgba(46, 49, 146, 0.8); }`;
  (doc.head || doc.documentElement).append(style);
  return highlight;
}

/**
 * The card that shows a placeholder's real value on hover. It lives in a
 * closed shadow root, so the page's scripts cannot read the value.
 * @param {Document} doc
 */
function createPeek(doc) {
  /** @type {HTMLElement | null} */
  let host = null;
  /** @type {HTMLElement | null} */
  let card = null;

  function ensure() {
    if (host) {
      return /** @type {HTMLElement} */ (card);
    }
    host = doc.createElement("safepaste-ui");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .card { position: fixed; z-index: 2147483647; max-width: 360px; padding: 8px 11px; border: 1px solid #3a3c48; border-radius: 8px;
        background: #15161e; color: #f2f3f7; font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; pointer-events: none; }
      .value { font-weight: 700; word-break: break-word; }
      .note { margin-top: 2px; color: #c5c8d4; font-size: 12px; }
    </style><div class="card" hidden><div class="value"></div><div class="note"></div></div>`;
    card = /** @type {HTMLElement} */ (root.querySelector(".card"));
    doc.documentElement.append(host);
    return card;
  }

  return {
    /**
     * @param {VaultEntry} entry
     * @param {DOMRect} rect
     */
    show(entry, rect) {
      const element = ensure();
      /** @type {HTMLElement} */ (element.querySelector(".value")).textContent = entry.value;
      /** @type {HTMLElement} */ (element.querySelector(".note")).textContent = `Real value of ${entry.key}, hidden from the AI by SafePaste`;
      element.hidden = false;
      // Inside the window: shifted left at the right edge, above the text near the bottom.
      const view = doc.documentElement;
      const left = Math.min(rect.left, view.clientWidth - element.offsetWidth - 8);
      const below = rect.bottom + 6 + element.offsetHeight <= view.clientHeight;
      element.style.left = `${Math.max(8, left)}px`;
      element.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - element.offsetHeight - 6)}px`;
    },
    hide() {
      if (card) {
        card.hidden = true;
      }
    }
  };
}
