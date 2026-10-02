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

  /** @type {MutationObserver | null} */
  let contentWatcher = null;
  /** @type {ResizeObserver | null} */
  let sizeWatcher = null;
  let renderQueued = false;

  /** Re-reads the prompt box once its editor has finished updating. */
  function queueRender() {
    if (!renderQueued) {
      renderQueued = true;
      win.requestAnimationFrame(() => {
        renderQueued = false;
        render();
      });
    }
  }

  return {
    /**
     * The prompt box the last paste went into. Rich editors (Gemini's
     * Quill, ProseMirror) finish inserting multi-line text after the paste
     * and grow as they do, so the chip follows the box's content and size.
     * @param {HTMLElement} element
     */
    setEditor(element) {
      if (editor !== element) {
        contentWatcher?.disconnect();
        sizeWatcher?.disconnect();
        editor = element;
        contentWatcher = new MutationObserver(queueRender);
        contentWatcher.observe(element, { subtree: true, childList: true, characterData: true });
        if (typeof ResizeObserver === "function") {
          sizeWatcher = new ResizeObserver(() => position());
          sizeWatcher.observe(element);
        }
      }
      render();
    },
    render
  };
}

const CSS = `
  .chip { --surface: #ffffff; --border: #c9ccd8; --line: #e4e5eb; --text: #15161e; --muted: #464a59;
    --accent: #3034a6; --accent-soft: #e7e8fa; --on-accent: #ffffff;
    position: fixed; z-index: 2147483646; color: var(--text); font: 13px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .bar { display: flex; align-items: center; gap: 6px; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 9px; }
  .mark { position: relative; flex: none; width: 22px; height: 22px; margin-left: 2px; border-radius: 6px; background: var(--accent); }
  .mark::before { content: ""; position: absolute; left: 6px; top: 5px; width: 10px; height: 12px; border-radius: 2px; background: var(--on-accent); }
  .mark::after { content: ""; position: absolute; left: 8px; top: 10px; width: 6px; height: 3px; background: var(--accent); }
  button { font: inherit; font-weight: 700; cursor: pointer; border: 1px solid transparent; border-radius: 6px; padding: 4px 10px; }
  .review { background: var(--accent-soft); color: var(--accent); }
  .copy { background: var(--accent); color: var(--on-accent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .panel { position: absolute; right: 0; bottom: calc(100% + 6px); width: 340px; max-height: 320px; overflow: auto; padding: 12px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
  .panel-title { margin-bottom: 6px; font-weight: 700; }
  .items { list-style: none; margin: 0; padding: 0; }
  .items li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--line); }
  .items li:first-child { border-top: 0; }
  .type { padding: 2px 6px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); font: 700 11px ui-monospace, Consolas, monospace; text-transform: uppercase; }
  .value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .items button { padding: 3px 9px; background: var(--surface); border-color: var(--border); color: var(--accent); font-size: 12px; }
  .items button:hover { border-color: var(--accent); }
  .panel-note { margin-top: 8px; color: var(--muted); font-size: 12px; }
  [hidden] { display: none !important; }
  @media (prefers-color-scheme: dark) {
    .chip { --surface: #18191f; --border: #3a3c48; --line: #262832; --text: #f2f3f7; --muted: #c5c8d4;
      --accent: #a7abff; --accent-soft: #272a4f; --on-accent: #0e0f14; }
  }
`;
