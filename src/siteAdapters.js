// Knows which sites are supported, which element on each site is the prompt
// editor, and how to insert text into it so the site's editor picks it up.

import { SITE_LIST } from "./shared/sites.js";

/**
 * @typedef {object} Site
 * @property {import("./shared/sites.js").SiteId} id
 * @property {string} name
 */

/** @type {Record<string, Site>} by hostname */
const SITES = Object.fromEntries(SITE_LIST.flatMap(({ id, name, hosts }) => hosts.map((host) => [host, { id, name }])));

/** @type {Record<Site["id"], string[]>} */
const PROMPT_SELECTORS = {
  chatgpt: [
    "#prompt-textarea",
    "textarea[data-id='root']",
    "[data-testid='composer'] [contenteditable='true']",
    "[data-testid='composer'] textarea",
    "div.ProseMirror[contenteditable='true']",
    "[contenteditable='true'][aria-label*='message' i]",
    "[contenteditable='true'][data-placeholder*='message' i]"
  ],
  gemini: [
    "rich-textarea",
    "div.ql-editor[contenteditable='true']",
    "[contenteditable='true'][aria-label*='prompt' i]",
    "[contenteditable='true'][aria-label*='message' i]",
    "[contenteditable='true'][data-placeholder*='prompt' i]"
  ],
  claude: [
    "[data-testid='chat-input'] div.ProseMirror[contenteditable='true']",
    "[data-testid='chat-input'] [contenteditable='true']",
    "div.ProseMirror[contenteditable='true']",
    "[contenteditable='true'][aria-label*='message' i]",
    "[contenteditable='true'][aria-label*='prompt' i]",
    "[contenteditable='true'][data-placeholder*='reply' i]"
  ],
  // Lexical editor.
  perplexity: [
    "#ask-input",
    "[data-lexical-editor='true'][contenteditable='true']"
  ],
  mistral: [
    "div.ProseMirror[contenteditable='true']",
    "[contenteditable='true'][data-placeholder]"
  ],
  // The visible prompt textarea; Grok also has an aria-hidden sizing copy.
  grok: [
    "textarea[aria-label]:not([aria-hidden='true'])",
    "form textarea:not([aria-hidden='true'])"
  ],
  // CSS-module class names: match the stable part, not the generated suffix.
  poe: [
    "textarea[class*='GrowingTextArea_textArea']",
    "[class*='ChatMessageInputContainer'] textarea"
  ]
};

// The AI's replies, newest last, for "Copy last reply with real values".
// Sites not listed here still get real values when a reply is selected and
// copied; only the one-click button needs the site's layout.
/** @type {Partial<Record<Site["id"], string>>} */
const REPLY_SELECTORS = {
  chatgpt: "[data-message-author-role='assistant']",
  gemini: "model-response message-content, model-response",
  claude: "[data-is-streaming] .font-claude-response, .font-claude-response, [data-is-streaming]"
};

/**
 * Whether "Copy last reply" knows where this site's replies are.
 * @param {Site} site
 */
export function knowsReplyLayout(site) {
  return Boolean(REPLY_SELECTORS[site.id]);
}

/**
 * The most recent AI reply on the page, if the site's layout is known.
 * @param {Site} site
 * @param {Document} [doc]
 * @returns {HTMLElement | null}
 */
export function lastReply(site, doc = document) {
  const selector = REPLY_SELECTORS[site.id];
  const replies = selector ? doc.querySelectorAll(selector) : [];
  return replies.length ? /** @type {HTMLElement} */ (replies[replies.length - 1]) : null;
}

/**
 * Text currently in a prompt editor.
 * @param {HTMLElement} editable
 */
export function editorText(editable) {
  return editable.tagName === "TEXTAREA" ? /** @type {HTMLTextAreaElement} */ (editable).value : editable.innerText || editable.textContent || "";
}

/**
 * Replaces the first occurrence of `search` in a prompt editor, through the
 * same insertion path as a paste so the site's editor state stays in step.
 * @param {HTMLElement} editable
 * @param {string} search
 * @param {string} replacement
 * @returns {boolean} Whether it was found and replaced.
 */
export function replaceInEditor(editable, search, replacement) {
  if (editable.tagName === "TEXTAREA") {
    const textarea = /** @type {HTMLTextAreaElement} */ (editable);
    const index = textarea.value.indexOf(search);
    if (index === -1) {
      return false;
    }
    textarea.focus();
    textarea.setSelectionRange(index, index + search.length);
    return insertText(textarea, replacement);
  }

  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = (node.nodeValue || "").indexOf(search);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + search.length);
      editable.focus();
      const selection = document.getSelection();
      if (!selection) {
        return false;
      }
      selection.removeAllRanges();
      selection.addRange(range);
      return insertText(editable, replacement);
    }
  }
  return false;
}

/**
 * @param {Location} loc
 * @param {Document} doc
 * @returns {Site | null}
 */
export function currentSite(loc = location, doc = document) {
  // The local test harness opts in to a site's behaviour with a data attribute.
  if (loc.hostname === "127.0.0.1" || loc.hostname === "localhost") {
    const testSite = doc.documentElement && doc.documentElement.dataset.redactorTestSite;
    return Object.values(SITES).find((site) => site.id === testSite) || null;
  }

  return SITES[loc.hostname] || null;
}

/**
 * The supported site at `hostname`, for the popup's status line.
 * @param {string} hostname
 * @returns {Site | null}
 */
export function siteForHostname(hostname) {
  return Object.prototype.hasOwnProperty.call(SITES, hostname) ? SITES[hostname] : null;
}

/** Names of the supported sites, e.g. for "Works on ChatGPT, Gemini and Claude". */
export const SUPPORTED_SITE_NAMES = SITE_LIST.filter((site) => !site.optional).map((site) => site.name);

/**
 * The editable element an event is aimed at, looking through shadow roots.
 * @param {Event} event
 * @returns {HTMLElement | null}
 */
export function editableFromEvent(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of path) {
    if (isEditable(node)) {
      return editingHost(/** @type {HTMLElement} */ (node));
    }
  }

  const active = deepestActiveEditable(document);
  return active ? editingHost(active) : null;
}

/**
 * The whole editor, not the paragraph the caret is in: inside a rich editor
 * (Gemini's Quill, ProseMirror) every line is editable too.
 * @param {HTMLElement} element
 */
function editingHost(element) {
  let host = element;
  while (host.tagName !== "TEXTAREA" && host.parentElement && isEditable(host.parentElement)) {
    host = host.parentElement;
  }
  return host;
}

/**
 * Like editableFromEvent, but only returns the site's prompt editor, so login,
 * search and settings fields are never touched.
 * @param {Event} event
 * @param {Site | null} site
 * @returns {HTMLElement | null}
 */
export function promptEditableFromEvent(event, site) {
  const editable = editableFromEvent(event);
  if (!editable || !site) {
    return null;
  }

  return isPromptEditable(editable, site) ? editable : null;
}

/**
 * @param {Document | ShadowRoot} root
 * @returns {HTMLElement | null}
 */
function deepestActiveEditable(root) {
  let active = root.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return isEditable(active) ? /** @type {HTMLElement} */ (active) : null;
}

/**
 * @param {EventTarget | null} node
 * @returns {boolean}
 */
function isEditable(node) {
  if (!node || /** @type {Node} */ (node).nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const element = /** @type {HTMLElement} */ (node);
  if (element.tagName === "TEXTAREA") {
    const textarea = /** @type {HTMLTextAreaElement} */ (element);
    return !textarea.disabled && !textarea.readOnly;
  }

  if (element.tagName === "INPUT") {
    return false;
  }

  if (typeof element.isContentEditable === "boolean") {
    return element.isContentEditable;
  }
  // Fallback for DOM implementations without isContentEditable (jsdom).
  const host = element.closest("[contenteditable]");
  return Boolean(host && host.getAttribute("contenteditable") !== "false");
}

/**
 * @param {HTMLElement} editable
 * @param {Site} site
 */
function isPromptEditable(editable, site) {
  const selectors = PROMPT_SELECTORS[site.id] || [];
  return selectors.some((selector) => matchesSelfOrAncestor(editable, selector));
}

/**
 * @param {Element} element
 * @param {string} selector
 */
function matchesSelfOrAncestor(element, selector) {
  try {
    return Boolean(element.closest(selector));
  } catch (_error) {
    return false;
  }
}

/**
 * Moves the caret to the drop point so dropped text lands where the user let go.
 * Only applies to contenteditable editors; textareas keep their own selection.
 * @param {HTMLElement} editable
 * @param {number} x
 * @param {number} y
 */
export function placeCaretAtPoint(editable, x, y) {
  if (editable.tagName === "TEXTAREA" || typeof document.caretRangeFromPoint !== "function") {
    return;
  }
  const range = document.caretRangeFromPoint(x, y);
  const selection = document.getSelection();
  if (range && selection && editable.contains(range.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

/**
 * Inserts text at the caret, replacing any selection. Returns false when the
 * text could not be inserted, so the caller can tell the user.
 * @param {HTMLElement} editable
 * @param {string} text
 * @returns {boolean}
 */
export function insertText(editable, text) {
  if (editable.tagName === "TEXTAREA") {
    insertIntoTextarea(/** @type {HTMLTextAreaElement} */ (editable), text);
    return true;
  }

  focusKeepingSelection(editable);

  // execCommand keeps the browser's undo stack and fires the native
  // beforeinput/input events that rich editors (ProseMirror, Quill) listen to.
  if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) {
    return true;
  }

  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) {
    return false;
  }

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection.removeAllRanges();
  selection.addRange(range);
  dispatchInput(editable, text);
  return true;
}

/**
 * Focuses the editor without losing a caret or selection the user already
 * has inside it (focus() may reset it to the start).
 * @param {HTMLElement} editable
 */
function focusKeepingSelection(editable) {
  const selection = document.getSelection();
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  if (!editable.contains(document.activeElement)) {
    editable.focus();
  }
  if (selection && saved && editable.contains(saved.commonAncestorContainer)) {
    selection.removeAllRanges();
    selection.addRange(saved);
  }
}

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {string} text
 */
function insertIntoTextarea(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.setRangeText(text, start, end, "end");
  dispatchInput(textarea, text);
}

/**
 * @param {HTMLElement} element
 * @param {string} text
 */
function dispatchInput(element, text) {
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    composed: true,
    inputType: "insertText",
    data: text
  }));
}
