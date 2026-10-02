// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentSite, insertText, promptEditableFromEvent } from "../../src/siteAdapters.js";

/** @type {import("../../src/siteAdapters.js").Site} */
const chatgpt = { id: "chatgpt", name: "ChatGPT" };
/** @type {import("../../src/siteAdapters.js").Site} */
const gemini = { id: "gemini", name: "Gemini" };
/** @type {import("../../src/siteAdapters.js").Site} */
const claude = { id: "claude", name: "Claude" };

/** @param {string} html */
function mount(html) {
  document.body.innerHTML = html;
  return /** @type {HTMLElement} */ (document.querySelector("[data-target]"));
}

/** @param {EventTarget} target */
function eventAt(target) {
  return /** @type {Event} */ (/** @type {unknown} */ ({ composedPath: () => [target] }));
}

/** @param {string} hostname */
function at(hostname) {
  return /** @type {Location} */ (/** @type {unknown} */ ({ hostname }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("optional sites", () => {
  it("are recognised by hostname", () => {
    expect(currentSite(at("www.perplexity.ai"), document)?.id).toBe("perplexity");
    expect(currentSite(at("chat.mistral.ai"), document)?.id).toBe("mistral");
    expect(currentSite(at("grok.com"), document)?.id).toBe("grok");
  });

  it("find each site's prompt editor as seen on the live sites", () => {
    const perplexity = mount(`<div id="ask-input" contenteditable="true" role="textbox" data-lexical-editor="true"><p data-target>hi</p></div>`);
    expect(promptEditableFromEvent(eventAt(perplexity), { id: "perplexity", name: "Perplexity" })?.id).toBe("ask-input");

    const mistral = mount(`<div class="ProseMirror" contenteditable="true" data-placeholder="Ask anything" data-target></div>`);
    expect(promptEditableFromEvent(eventAt(mistral), { id: "mistral", name: "Mistral Le Chat" })).toBe(mistral);

    const grok = mount(`<form><textarea aria-label="Ask Grok anything" data-target></textarea></form><textarea aria-hidden="true" tabindex="-1"></textarea>`);
    expect(promptEditableFromEvent(eventAt(grok), { id: "grok", name: "Grok" })).toBe(grok);

    const poe = mount(`<div class="ChatMessageInputContainer_inputContainer__s2AGa"><textarea class="GrowingTextArea_textArea__ZWQbP" placeholder="Start a new chat" data-target></textarea></div>`);
    expect(promptEditableFromEvent(eventAt(poe), { id: "poe", name: "Poe" })).toBe(poe);
  });
});

describe("promptEditableFromEvent", () => {
  it("finds the ChatGPT textarea and ProseMirror editors", () => {
    const textarea = mount(`<textarea id="prompt-textarea" data-target></textarea>`);
    expect(promptEditableFromEvent(eventAt(textarea), chatgpt)).toBe(textarea);

    const prosemirror = mount(`<div class="ProseMirror" contenteditable="true" data-target></div>`);
    expect(promptEditableFromEvent(eventAt(prosemirror), chatgpt)).toBe(prosemirror);
  });

  it("finds the Gemini and Claude editors", () => {
    const quill = mount(`<rich-textarea><div class="ql-editor" contenteditable="true" data-target></div></rich-textarea>`);
    expect(promptEditableFromEvent(eventAt(quill), gemini)).toBe(quill);

    const claudeEditor = mount(`<div data-testid="chat-input"><div class="ProseMirror" contenteditable="true" data-target></div></div>`);
    expect(promptEditableFromEvent(eventAt(claudeEditor), claude)).toBe(claudeEditor);
  });

  it("finds the editor when the event targets a paragraph inside it", () => {
    const paragraph = mount(`<div class="ProseMirror" contenteditable="true"><p data-target>hi</p></div>`);
    // The whole editor, not the line: the review chip and Unhide need all of it.
    expect(promptEditableFromEvent(eventAt(paragraph), chatgpt)).toBe(paragraph.closest(".ProseMirror"));
  });

  it("ignores inputs and unrelated editable areas", () => {
    for (const type of ["password", "email", "text", "search"]) {
      const input = mount(`<input type="${type}" data-target>`);
      expect(promptEditableFromEvent(eventAt(input), chatgpt)).toBeNull();
    }

    const other = mount(`<div contenteditable="true" data-target></div>`);
    expect(promptEditableFromEvent(eventAt(other), chatgpt)).toBeNull();
  });

  it("ignores disabled and read-only textareas", () => {
    const disabled = mount(`<textarea id="prompt-textarea" disabled data-target></textarea>`);
    expect(promptEditableFromEvent(eventAt(disabled), chatgpt)).toBeNull();

    const readOnly = mount(`<textarea id="prompt-textarea" readonly data-target></textarea>`);
    expect(promptEditableFromEvent(eventAt(readOnly), chatgpt)).toBeNull();
  });
});

describe("currentSite", () => {
  it("maps supported hostnames and rejects others", () => {
    expect(currentSite(at("claude.ai"), document)).toEqual(claude);
    expect(currentSite(at("example.com"), document)).toBeNull();
  });

  it("lets localhost pages opt in to a site for testing", () => {
    document.documentElement.dataset.redactorTestSite = "gemini";
    expect(currentSite(at("127.0.0.1"), document)).toEqual(gemini);
    delete document.documentElement.dataset.redactorTestSite;
    expect(currentSite(at("127.0.0.1"), document)).toBeNull();
  });
});

describe("insertText", () => {
  it("replaces the textarea selection and fires input", () => {
    const textarea = /** @type {HTMLTextAreaElement} */ (mount(`<textarea data-target>hello world</textarea>`));
    textarea.setSelectionRange(6, 11);
    let inputs = 0;
    textarea.addEventListener("input", () => { inputs += 1; });

    expect(insertText(textarea, "there")).toBe(true);
    expect(textarea.value).toBe("hello there");
    expect(inputs).toBe(1);
  });

  it("inserts at the caret in a contenteditable editor", () => {
    const editor = mount(`<div contenteditable="true" data-target>hello </div>`);
    const range = document.createRange();
    range.setStart(/** @type {Node} */ (editor.firstChild), 6);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    expect(insertText(editor, "[[EMAIL_1]]")).toBe(true);
    expect(editor.textContent).toBe("hello [[EMAIL_1]]");
  });

  it("reports failure when there is no caret inside the editor", () => {
    const editor = mount(`<div contenteditable="true" data-target></div>`);
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "outside";
    document.body.append(elsewhere);
    const outside = document.createRange();
    outside.selectNodeContents(elsewhere);
    vi.spyOn(document, "getSelection").mockReturnValue(/** @type {Selection} */ (/** @type {unknown} */ ({
      rangeCount: 1,
      getRangeAt: () => outside,
      removeAllRanges() {},
      addRange() {}
    })));

    expect(insertText(editor, "text")).toBe(false);
    expect(editor.textContent).toBe("");
    expect(elsewhere.textContent).toBe("outside");
    vi.restoreAllMocks();
  });
});
