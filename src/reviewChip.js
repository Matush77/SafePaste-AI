// A small chip above the prompt box: "4 hidden · Review" lists what
// SafePaste hid in the message, with Unhide for each item, and "Copy reply
// with real values" once a reply contains placeholders. It lives in a closed
// shadow root, so the page's scripts cannot read the values it shows.

import { editorText, replaceInEditor } from "./siteAdapters.js";

/**
 * @typedef {import("./vault.js").Vault} Vault
 * @typedef {import("./vault.js").VaultEntry} VaultEntry
 * @typedef {{ count: () => number, lastReplyText: () => string | null }} Replies
 */

const MAX_SHOWN_LENGTH = 48;

/**
 * @param {object} options
 * @param {Vault} options.vault
 * @param {Replies} options.replies
 * @param {() => { notice: boolean, restoreValues: boolean }} options.settings
 * @param {(message: string) => void} options.notify
 * @param {Document} [options.doc]
 * @param {Window} [options.win]
 * @param {ShadowRootMode} [options.shadowMode] "closed" in the extension; tests use "open" to look inside.
 */
export function createReviewChip({ vault, replies, settings, notify, doc = document, win = window, shadowMode = "closed" }) {
  /** @type {HTMLElement | null} */
  let editor = null;
  let open = false;
  /** @type {{ host: HTMLElement, root: ShadowRoot } | null} */
  let ui = null;

  function ensureUi() {
    if (ui) {
      return ui;
    }
    const host = doc.createElement("safepaste-ui");
    const root = host.attachShadow({ mode: shadowMode });
    root.innerHTML = `<style>${CSS}</style><div class="chip" hidden>
      <div class="panel" hidden role="dialog" aria-label="Hidden by SafePaste">
        <div class="panel-title">Hidden from the AI</div>
        <ul class="items"></ul>
        <div class="panel-note">Real values stay in this tab only. Unhide puts one back into your message.</div>
      </div>
      <div class="bar">
        <span class="mark" aria-hidden="true"></span>
        <button class="review" type="button" aria-expanded="false"></button>
        <button class="copy" type="button">Copy reply with real values</button>
      </div>
    </div>`;
    doc.documentElement.append(host);
    ui = { host, root };

    const review = /** @type {HTMLButtonElement} */ (root.querySelector(".review"));
    review.addEventListener("click", () => {
      open = !open;
      render();
    });
    /** @type {HTMLButtonElement} */ (root.querySelector(".copy")).addEventListener("click", copyLastReply);
    // A click anywhere else closes the list.
    doc.addEventListener("pointerdown", (event) => {
      if (open && !event.composedPath().includes(host)) {
        open = false;
        render();
      }
    }, true);
    root.addEventListener("keydown", (event) => {
      if (/** @type {KeyboardEvent} */ (event).key === "Escape" && open) {
        open = false;
        render();
      }
    });
    win.addEventListener("resize", position, { passive: true });
    win.addEventListener("scroll", position, { passive: true, capture: true });
    doc.addEventListener("input", (event) => {
      if (editor && event.target instanceof Node && editor.contains(event.target)) {
        render();
      }
    }, true);
    return ui;
  }

  /** Hidden values still in the message, once each. */
  function hiddenInEditor() {
    if (!editor || !editor.isConnected) {
      return [];
    }
    const text = editorText(editor);
    /** @type {Map<string, { entry: VaultEntry, written: string }>} */
    const unique = new Map();
    for (const { start, end, entry } of vault.find(text)) {
      if (!unique.has(entry.key)) {
        unique.set(entry.key, { entry, written: text.slice(start, end) });
      }
    }
    return [...unique.values()];
  }

  function render() {
    const { notice, restoreValues } = settings();
    const hidden = notice ? hiddenInEditor() : [];
    const replyCount = restoreValues ? replies.count() : 0;
    if (!hidden.length && !replyCount) {
      if (ui) {
        /** @type {HTMLElement} */ (ui.root.querySelector(".chip")).hidden = true;
      }
      open = false;
      return;
    }
    const { root } = ensureUi();
    const chip = /** @type {HTMLElement} */ (root.querySelector(".chip"));
    const review = /** @type {HTMLButtonElement} */ (root.querySelector(".review"));
    const copy = /** @type {HTMLButtonElement} */ (root.querySelector(".copy"));
    const panel = /** @type {HTMLElement} */ (root.querySelector(".panel"));
    chip.hidden = false;

    review.hidden = !hidden.length;
    review.textContent = `${hidden.length} hidden · Review`;
    review.setAttribute("aria-expanded", String(open && hidden.length > 0));
    copy.hidden = !replyCount;

    panel.hidden = !(open && hidden.length);
    const list = /** @type {HTMLElement} */ (root.querySelector(".items"));
    list.textContent = "";
    for (const { entry, written } of hidden) {
      const item = doc.createElement("li");
      const type = doc.createElement("span");
      type.className = "type";
      type.textContent = entry.type.replace(/_/g, " ").toLowerCase();
      const value = doc.createElement("span");
      value.className = "value";
      value.textContent = entry.value.length > MAX_SHOWN_LENGTH ? `${entry.value.slice(0, MAX_SHOWN_LENGTH - 1)}…` : entry.value;
      value.title = entry.value;
      const unhide = doc.createElement("button");
      unhide.type = "button";
      unhide.textContent = "Unhide";
      unhide.setAttribute("aria-label", `Unhide ${entry.key}`);
      unhide.addEventListener("click", () => {
        if (editor && replaceInEditor(editor, written, entry.value)) {
          render();
        } else {
          notify("SafePaste AI: could not put that value back. Type it in yourself if you want to send it.");
        }
      });
      item.append(type, value, unhide);
      list.append(item);
    }
    position();
  }

  /** Keeps the chip just above the right end of the prompt box. */
  function position() {
    if (!ui) {
      return;
    }
    const chip = /** @type {HTMLElement} */ (ui.root.querySelector(".chip"));
    if (chip.hidden) {
      return;
    }
    const rect = editor && editor.isConnected ? editor.getBoundingClientRect() : null;
    const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < win.innerHeight;
    chip.style.right = `${visible ? Math.max(8, win.innerWidth - /** @type {DOMRect} */ (rect).right) : 16}px`;
    chip.style.bottom = `${visible ? Math.max(8, win.innerHeight - /** @type {DOMRect} */ (rect).top + 8) : 16}px`;
  }

  async function copyLastReply() {
    const text = replies.lastReplyText();
    if (!text) {
      notify("SafePaste AI: the last reply has no hidden values to fill in.");
      return;
    }
    try {
      await win.navigator.clipboard.writeText(text);
      notify("SafePaste AI: copied the last reply with real values.");
    } catch (_error) {
      notify("SafePaste AI: could not copy. Select the reply and copy it instead; real values are filled in.");
    }
  }

  return {
    /**
     * The prompt box the last paste went into.
     * @param {HTMLElement} element
     */
    setEditor(element) {
      editor = element;
      render();
    },
    render
  };
}

const CSS = `
  .chip { position: fixed; z-index: 2147483646; font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: #12142b; }
  .bar { display: flex; align-items: center; gap: 6px; background: #ffffff; border: 1px solid #dee1f0; border-radius: 999px;
    padding: 4px 6px 4px 8px; box-shadow: 0 6px 18px rgba(18, 20, 43, 0.14); }
  .mark { width: 14px; height: 16px; border-radius: 3px; background: #2e3192; position: relative; flex: 0 0 auto; }
  .mark::after { content: ""; position: absolute; left: 3px; right: 3px; top: 7px; height: 3px; background: #fff; border-radius: 1px; }
  button { font: inherit; cursor: pointer; border: 0; border-radius: 999px; padding: 4px 10px; }
  .review { background: #eef0f8; color: #2e3192; font-weight: 600; }
  .copy { background: #2e3192; color: #fff; font-weight: 600; }
  button:focus-visible { outline: 2px solid #2e3192; outline-offset: 2px; }
  .panel { position: absolute; right: 0; bottom: calc(100% + 8px); width: 340px; max-height: 320px; overflow: auto; background: #fff;
    border: 1px solid #dee1f0; border-radius: 12px; box-shadow: 0 12px 32px rgba(18, 20, 43, 0.18); padding: 10px 12px; }
  .panel-title { font-weight: 700; margin-bottom: 6px; }
  .items { list-style: none; margin: 0; padding: 0; }
  .items li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid #eef0f8; }
  .items li:first-child { border-top: 0; }
  .type { font: 600 11px ui-monospace, Consolas, monospace; color: #2e3192; background: #eef0f8; border-radius: 5px; padding: 2px 6px; text-transform: uppercase; }
  .value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .items button { background: #fff; border: 1px solid #dee1f0; color: #2e3192; padding: 3px 9px; font-size: 12px; }
  .panel-note { color: #5b6078; font-size: 11.5px; margin-top: 8px; }
  [hidden] { display: none !important; }
  @media (prefers-color-scheme: dark) {
    .bar, .panel { background: #1e2039; border-color: #2f3252; }
    .chip { color: #eceefa; }
    .review, .type { background: #2a2d4d; color: #a9adf5; }
    .copy { background: #8a8ff0; color: #14152a; }
    .items li { border-color: #2f3252; }
    .items button { background: #1e2039; border-color: #2f3252; color: #a9adf5; }
    .panel-note { color: #a6aac4; }
  }
`;
