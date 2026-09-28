const assert = require("node:assert/strict");

global.window = global;
global.location = { hostname: "chatgpt.com" };
global.Node = { ELEMENT_NODE: 1 };
global.document = {
  activeElement: null,
  getSelection() {
    return null;
  },
  queryCommandSupported() {
    return false;
  }
};
global.InputEvent = class InputEvent {
  constructor(type, init) {
    this.type = type;
    this.init = init;
  }
};

require("../src/siteAdapters.js");

function element({ tagName, selectorMatches = [], type = "text", isContentEditable = false }) {
  return {
    nodeType: Node.ELEMENT_NODE,
    tagName,
    disabled: false,
    readOnly: false,
    isContentEditable,
    getAttribute(name) {
      return name === "type" ? type : null;
    },
    matches(selector) {
      return selectorMatches.includes(selector);
    },
    closest(selector) {
      return selectorMatches.includes(selector) ? this : null;
    }
  };
}

function pasteEvent(target) {
  return {
    composedPath() {
      return [target];
    }
  };
}

const chatgpt = { id: "chatgpt", name: "ChatGPT" };
const gemini = { id: "gemini", name: "Gemini" };
const claude = { id: "claude", name: "Claude" };

const promptTextarea = element({
  tagName: "TEXTAREA",
  selectorMatches: ["#prompt-textarea"]
});
assert.equal(window.SensitivePasteSites.promptEditableFromEvent(pasteEvent(promptTextarea), chatgpt), promptTextarea);

const chatgptProseMirror = element({
  tagName: "DIV",
  isContentEditable: true,
  selectorMatches: ["div.ProseMirror[contenteditable='true']"]
});
assert.equal(window.SensitivePasteSites.promptEditableFromEvent(pasteEvent(chatgptProseMirror), chatgpt), chatgptProseMirror);

const geminiEditor = element({
  tagName: "DIV",
  isContentEditable: true,
  selectorMatches: ["div.ql-editor[contenteditable='true']"]
});
assert.equal(window.SensitivePasteSites.promptEditableFromEvent(pasteEvent(geminiEditor), gemini), geminiEditor);

const claudeEditor = element({
  tagName: "DIV",
  isContentEditable: true,
  selectorMatches: ["div.ProseMirror[contenteditable='true']"]
});
assert.equal(window.SensitivePasteSites.promptEditableFromEvent(pasteEvent(claudeEditor), claude), claudeEditor);

const passwordInput = element({
  tagName: "INPUT",
  type: "password"
});
assert.equal(window.SensitivePasteSites.promptEditableFromEvent(pasteEvent(passwordInput), chatgpt), null);

const emailInput = element({
  tagName: "INPUT",
  type: "email"
});
assert.equal(window.SensitivePasteSites.promptEditableFromEvent(pasteEvent(emailInput), chatgpt), null);

const randomContentEditable = element({
  tagName: "DIV",
  isContentEditable: true
});
assert.equal(window.SensitivePasteSites.promptEditableFromEvent(pasteEvent(randomContentEditable), chatgpt), null);

console.log("Site adapter test passed.");
