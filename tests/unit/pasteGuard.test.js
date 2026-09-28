// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToText, installPasteGuard } from "../../src/pasteGuard.js";
import { LAST_REDACTION_KEY, SETTINGS_KEY } from "../../src/shared/storageKeys.js";

/** @type {import("../../src/siteAdapters.js").Site} */
const site = { id: "chatgpt", name: "ChatGPT" };
const SENSITIVE = "Contact Dr. Jane Smith at jane.smith@example.com.";

/** @type {(() => void)[]} */
let cleanups = [];

afterEach(() => {
  for (const cleanup of cleanups) {
    cleanup();
  }
  cleanups = [];
  document.body.innerHTML = "";
});

/**
 * @param {{ stored?: object, fail?: boolean, pending?: boolean }} [options]
 */
function setup({ stored, fail = false, pending = false } = {}) {
  /** @type {Record<string, any>[]} */
  const localWrites = [];
  /** @type {string[]} */
  const notices = [];
  /** @type {((changes: any, area: string) => void)[]} */
  const changeListeners = [];

  const storage = {
    sync: {
      get: () => {
        if (fail) {
          return Promise.reject(new Error("storage unavailable"));
        }
        if (pending) {
          return new Promise(() => {});
        }
        return Promise.resolve(stored ? { [SETTINGS_KEY]: stored } : {});
      },
      set: () => Promise.resolve()
    },
    local: {
      get: () => Promise.resolve({}),
      /** @param {Record<string, any>} items */
      set: (items) => {
        localWrites.push(items);
        return Promise.resolve();
      }
    },
    onChanged: {
      /** @param {(changes: any, area: string) => void} listener */
      addListener: (listener) => changeListeners.push(listener)
    }
  };

  const guard = installPasteGuard({ site, storage, notify: (message) => notices.push(message) });
  cleanups.push(guard.dispose);
  return { guard, localWrites, notices, changeListeners };
}

/** @param {string} html */
function mount(html) {
  document.body.insertAdjacentHTML("beforeend", html);
  return /** @type {HTMLElement} */ (document.body.lastElementChild);
}

function promptTextarea() {
  return /** @type {HTMLTextAreaElement} */ (mount(`<textarea id="prompt-textarea"></textarea>`));
}

/** @param {Record<string, string>} data */
function transfer(data) {
  return { getData: (/** @type {string} */ type) => data[type] || "", files: [] };
}

/**
 * @param {Element} target
 * @param {Record<string, string>} data
 */
function paste(target, data) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: transfer(data) });
  target.dispatchEvent(event);
  return event;
}

/**
 * @param {Element} target
 * @param {Record<string, string>} data
 */
function drop(target, data) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer(data) });
  target.dispatchEvent(event);
  return event;
}

describe("paste into the prompt editor", () => {
  it("inserts a redacted copy instead of the original", async () => {
    const { guard, localWrites, notices } = setup();
    await guard.ready;
    const prompt = promptTextarea();

    const event = paste(prompt, { "text/plain": SENSITIVE });

    expect(event.defaultPrevented).toBe(true);
    expect(prompt.value).toBe("Contact Dr. [[PERSON_1]] at [[EMAIL_1]].");
    expect(notices).toEqual(["SafePaste AI: redacted 2 items."]);
    expect(localWrites).toHaveLength(1);
  });

  it("stores only site, time and counts in the last-redaction summary", async () => {
    const { guard, localWrites } = setup();
    await guard.ready;
    paste(promptTextarea(), { "text/plain": SENSITIVE });

    const summary = localWrites[0][LAST_REDACTION_KEY];
    expect(Object.keys(summary).sort()).toEqual(["findings", "site", "timestamp"]);
    expect(summary.findings).toEqual({ counts: { PERSON: 1, EMAIL: 1 }, total: 2 });
    expect(JSON.stringify(summary)).not.toMatch(/jane|smith|chatgpt\.com/i);
  });

  it("lets text without sensitive data paste normally", async () => {
    const { guard } = setup();
    await guard.ready;
    const prompt = promptTextarea();

    const event = paste(prompt, { "text/plain": "Explain how to debounce a text input in React." });

    expect(event.defaultPrevented).toBe(false);
    expect(prompt.value).toBe("");
  });

  it("does not show a notice when notices are turned off", async () => {
    const { guard, notices } = setup({ stored: { showToast: false } });
    await guard.ready;
    paste(promptTextarea(), { "text/plain": SENSITIVE });
    expect(notices).toEqual([]);
  });
});

describe("failing closed", () => {
  it("redacts a paste that happens before settings have loaded", () => {
    setup({ pending: true });
    const prompt = promptTextarea();

    const event = paste(prompt, { "text/plain": SENSITIVE });

    expect(event.defaultPrevented).toBe(true);
    expect(prompt.value).not.toContain("jane.smith@example.com");
  });

  it("keeps redacting when settings cannot be read", async () => {
    const { guard } = setup({ fail: true });
    await guard.ready;
    const prompt = promptTextarea();

    paste(prompt, { "text/plain": SENSITIVE });

    expect(prompt.value).toBe("Contact Dr. [[PERSON_1]] at [[EMAIL_1]].");
  });

  it("blocks the paste and says so when the redacted text cannot be inserted", async () => {
    const { guard, notices } = setup();
    await guard.ready;
    const editor = mount(`<div class="ProseMirror" contenteditable="true"></div>`);
    const elsewhere = mount(`<p>outside</p>`);
    const selection = /** @type {Selection} */ (document.getSelection());
    const range = document.createRange();
    range.selectNodeContents(elsewhere);
    selection.removeAllRanges();
    selection.addRange(range);
    // Keep focus from moving the caret into the editor.
    editor.focus = () => {};

    const event = paste(editor, { "text/plain": SENSITIVE });

    expect(event.defaultPrevented).toBe(true);
    expect(editor.textContent).toBe("");
    expect(elsewhere.textContent).toBe("outside");
    expect(notices[0]).toMatch(/blocked this paste/);
  });
});

describe("settings", () => {
  it("does nothing when the user has turned redaction off", async () => {
    const { guard } = setup({ stored: { enabled: false } });
    await guard.ready;
    const prompt = promptTextarea();

    const event = paste(prompt, { "text/plain": SENSITIVE });

    expect(event.defaultPrevented).toBe(false);
    expect(prompt.value).toBe("");
  });

  it("follows settings changed in the popup", async () => {
    const { guard, changeListeners } = setup();
    await guard.ready;
    for (const listener of changeListeners) {
      listener({ [SETTINGS_KEY]: { newValue: { enabled: false } } }, "sync");
    }

    expect(paste(promptTextarea(), { "text/plain": SENSITIVE }).defaultPrevented).toBe(false);
  });
});

describe("fields that are not the prompt editor", () => {
  it("never touches login, email or search inputs", async () => {
    const { guard } = setup();
    await guard.ready;
    for (const type of ["email", "password", "search", "text"]) {
      const input = /** @type {HTMLInputElement} */ (mount(`<input type="${type}">`));
      const event = paste(input, { "text/plain": "jane.smith@example.com" });
      expect(event.defaultPrevented).toBe(false);
      expect(input.value).toBe("");
    }
  });
});

describe("HTML clipboard content", () => {
  it("redacts clipboards that only carry HTML", async () => {
    const { guard } = setup();
    await guard.ready;
    const editor = mount(`<div class="ProseMirror" contenteditable="true"></div>`);

    const event = paste(editor, { "text/html": "<p>Mail <b>jane.smith@example.com</b></p><p>Thanks</p>" });

    expect(event.defaultPrevented).toBe(true);
    expect(editor.textContent).toBe("Mail [[EMAIL_1]]\nThanks");
  });

  it("pastes as plain text when a link hides a sensitive value", async () => {
    const { guard, notices } = setup();
    await guard.ready;
    const editor = mount(`<div class="ProseMirror" contenteditable="true"></div>`);

    const event = paste(editor, {
      "text/plain": "Reset your password here",
      "text/html": `<a href="https://example.com/reset?token=9f8e7d6c5b4a3f2e1d">Reset your password here</a>`
    });

    expect(event.defaultPrevented).toBe(true);
    expect(editor.textContent).toBe("Reset your password here");
    expect(editor.querySelector("a")).toBeNull();
    expect(notices[0]).toMatch(/pasted as plain text/);
  });

  it("finds emails hidden in mailto links", async () => {
    const { guard } = setup();
    await guard.ready;
    const editor = mount(`<div class="ProseMirror" contenteditable="true"></div>`);

    const event = paste(editor, {
      "text/plain": "Email us",
      "text/html": `<a href="mailto:jane.smith@example.com">Email us</a>`
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it("lets harmless rich text paste normally", async () => {
    const { guard } = setup();
    await guard.ready;
    const editor = mount(`<div class="ProseMirror" contenteditable="true"></div>`);

    const event = paste(editor, {
      "text/plain": "See the React docs",
      "text/html": `<a href="https://react.dev/learn">See the React docs</a>`
    });

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("drag and drop", () => {
  it("redacts text dropped from outside the page", async () => {
    const { guard } = setup();
    await guard.ready;
    const prompt = promptTextarea();

    const event = drop(prompt, { "text/plain": SENSITIVE });

    expect(event.defaultPrevented).toBe(true);
    expect(prompt.value).toBe("Contact Dr. [[PERSON_1]] at [[EMAIL_1]].");
  });

  it("leaves text dragged within the page alone", async () => {
    const { guard } = setup();
    await guard.ready;
    const prompt = promptTextarea();

    prompt.dispatchEvent(new Event("dragstart", { bubbles: true }));
    const event = drop(prompt, { "text/plain": SENSITIVE });

    expect(event.defaultPrevented).toBe(false);
    expect(prompt.value).toBe("");
  });
});

describe("with the name model", () => {
  const NAMES = "Kowalski approved it, but Adaeze Okonkwo must sign.";

  /**
   * @param {(text: string) => Promise<any[]>} detect
   * @param {object} [stored]
   */
  function setupWithModel(detect, stored = { nameModel: true }) {
    const notices = /** @type {string[]} */ ([]);
    const storage = {
      sync: { get: () => Promise.resolve({ [SETTINGS_KEY]: stored }), set: () => Promise.resolve() },
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      onChanged: { addListener() {} }
    };
    const guard = installPasteGuard({ site, storage, notify: (message) => notices.push(message), nameModel: { detect } });
    cleanups.push(guard.dispose);
    return { guard, notices };
  }

  /** @param {string} text @param {string} name */
  const nameSpan = (text, name) => [{ start: text.indexOf(name), end: text.indexOf(name) + name.length, type: "PERSON", category: "people", confidence: "high", source: "model" }];

  it("holds the paste and redacts the names the model finds", async () => {
    const { guard } = setupWithModel(async (text) => nameSpan(text, "Adaeze Okonkwo"));
    await guard.ready;
    const prompt = promptTextarea();

    const event = paste(prompt, { "text/plain": NAMES });
    expect(event.defaultPrevented).toBe(true);
    await guard.whenIdle();

    expect(prompt.value).toBe("Kowalski approved it, but [[PERSON_1]] must sign.");
  });

  it("inserts harmless text unchanged after the model finds nothing", async () => {
    const { guard, notices } = setupWithModel(async () => []);
    await guard.ready;
    const prompt = promptTextarea();

    paste(prompt, { "text/plain": "Explain useEffect cleanup." });
    await guard.whenIdle();

    expect(prompt.value).toBe("Explain useEffect cleanup.");
    expect(notices).toEqual([]);
  });

  it("falls back to the rules and says so when the model fails", async () => {
    const { guard, notices } = setupWithModel(async () => {
      throw new Error("not downloaded");
    });
    await guard.ready;
    const prompt = promptTextarea();

    paste(prompt, { "text/plain": `${NAMES} Mail a@example.com.` });
    await guard.whenIdle();

    expect(prompt.value).toContain("Adaeze Okonkwo");
    expect(prompt.value).toContain("[[EMAIL_1]]");
    expect(notices.at(-1)).toMatch(/name model did not respond/);
  });

  it("falls back to the rules when the model is too slow", async () => {
    vi.useFakeTimers();
    try {
      const { guard, notices } = setupWithModel(() => new Promise(() => {}));
      await guard.ready;
      const prompt = promptTextarea();

      paste(prompt, { "text/plain": "Mail a@example.com" });
      await vi.advanceTimersByTimeAsync(20000);
      await guard.whenIdle();

      expect(prompt.value).toBe("Mail [[EMAIL_1]]");
      expect(notices.at(-1)).toMatch(/name model did not respond/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps several pastes in order while waiting", async () => {
    /** @type {((value: any[]) => void)[]} */
    const resolvers = [];
    const { guard } = setupWithModel(() => new Promise((resolve) => resolvers.push(resolve)));
    await guard.ready;
    const prompt = promptTextarea();

    paste(prompt, { "text/plain": "first " });
    paste(prompt, { "text/plain": "second" });
    await Promise.resolve();
    resolvers[0]([]);
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]([]);
    await guard.whenIdle();

    expect(prompt.value).toBe("first second");
  });

  it("does not hold pastes when the setting is off", async () => {
    let calls = 0;
    const { guard } = setupWithModel(async () => {
      calls += 1;
      return [];
    }, { nameModel: false });
    await guard.ready;

    const event = paste(promptTextarea(), { "text/plain": NAMES });

    expect(event.defaultPrevented).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("htmlToText", () => {
  it("keeps line breaks between blocks and drops scripts and styles", () => {
    expect(htmlToText("<div>one</div><div>two<br>three</div><style>x{}</style><script>alert(1)</script>"))
      .toBe("one\ntwo\nthree");
  });
});
