const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runContentScript({ storageError = false, storedSettings, targetKind = "prompt", pasteText } = {}) {
  const storageWrites = [];
  const listeners = {};
  const promptElement = makeElement("TEXTAREA", ["#prompt-textarea"]);
  const prosemirrorElement = makeElement("DIV", ["div.ProseMirror[contenteditable='true']"]);
  prosemirrorElement.isContentEditable = true;
  const emailElement = makeElement("INPUT", [], "email");
  const target = targetKind === "contenteditable" ? prosemirrorElement : targetKind === "prompt" ? promptElement : emailElement;

  const context = {
    console,
    location: {
      hostname: "chatgpt.com",
      origin: "https://chatgpt.com"
    },
    Node: { ELEMENT_NODE: 1 },
    InputEvent: class InputEvent {
      constructor(type, init) {
        this.type = type;
        this.init = init;
      }
    },
    addEventListener(type, listener) {
      listeners[`window:${type}`] = listener;
    },
    document: {
      activeElement: target,
      addEventListener(type, listener) {
        listeners[`document:${type}`] = listener;
      },
      queryCommandSupported() {
        return false;
      },
      getSelection() {
        return {
          rangeCount: 0
        };
      }
    },
    chrome: {
      runtime: {
        lastError: null
      },
      storage: {
        sync: {
          get(_key, callback) {
            context.chrome.runtime.lastError = storageError ? { message: "storage failed" } : null;
            callback(storedSettings ? { sensitivePasteSettings: storedSettings } : {});
            context.chrome.runtime.lastError = null;
          }
        },
        local: {
          get(_key, callback) {
            callback({});
          },
          set(value) {
            storageWrites.push(value);
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    },
    window: {}
  };

  context.window = context;
  vm.createContext(context);
  for (const file of ["src/redactor.js", "src/siteAdapters.js", "src/contentScript.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
  }

  const textToPaste = pasteText || "Contact Dr. Jane Smith at jane.smith@example.com.";
  const event = {
    defaultPrevented: false,
    clipboardData: {
      getData(type) {
        return type === "text/plain" ? textToPaste : "";
      }
    },
    composedPath() {
      return [target];
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    }
  };

  listeners["window:paste"](event);
  if (!event.stopped && listeners["document:paste"]) {
    listeners["document:paste"](event);
  }

  return {
    event,
    promptValue: promptElement.value,
    prosemirrorText: prosemirrorElement.textContent,
    emailValue: emailElement.value,
    storageWrites
  };
}

function makeElement(tagName, selectorMatches = [], type = "text") {
  return {
    nodeType: 1,
    tagName,
    value: "",
    textContent: "",
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    selectionStart: 0,
    selectionEnd: 0,
    getAttribute(name) {
      return name === "type" ? type : null;
    },
    matches(selector) {
      return selectorMatches.includes(selector);
    },
    closest(selector) {
      return selectorMatches.includes(selector) ? this : null;
    },
    focus() {},
    setRangeText(text) {
      this.value = text;
    },
    dispatchEvent() {}
  };
}

const promptResult = runContentScript();
assert.equal(promptResult.event.defaultPrevented, true);
assert.match(promptResult.promptValue, /\[\[PERSON_1\]\]/);
assert.match(promptResult.promptValue, /\[\[EMAIL_1\]\]/);
assert.doesNotMatch(promptResult.promptValue, /Jane Smith/);
assert.doesNotMatch(promptResult.promptValue, /jane\.smith@example\.com/);
assert.equal(promptResult.storageWrites.length, 1);
assert.equal(JSON.stringify(promptResult.storageWrites).includes("redactedText"), false);

const storageErrorResult = runContentScript({ storageError: true });
assert.equal(storageErrorResult.event.defaultPrevented, false);
assert.equal(storageErrorResult.promptValue, "");
assert.equal(storageErrorResult.storageWrites.length, 0);

const disabledResult = runContentScript({ storedSettings: { enabled: false } });
assert.equal(disabledResult.event.defaultPrevented, false);
assert.equal(disabledResult.promptValue, "");

const emailInputResult = runContentScript({ targetKind: "email" });
assert.equal(emailInputResult.event.defaultPrevented, false);
assert.equal(emailInputResult.emailValue, "");

const contactBlock = `Contact Us
Phone Icon
+1 (855) 234-5020
Address Icon
906 W 2ND AVE, STE 100
SPOKANE, WA 99201-4540, United States`;
const contenteditableResult = runContentScript({
  targetKind: "contenteditable",
  pasteText: contactBlock
});
assert.equal(contenteditableResult.event.defaultPrevented, true);
assert.match(contenteditableResult.prosemirrorText, /\[\[PHONE_1\]\]/);
assert.match(contenteditableResult.prosemirrorText, /\[\[ADDRESS_1\]\]/);
assert.match(contenteditableResult.prosemirrorText, /\[\[ADDRESS_2\]\]/);
assert.doesNotMatch(contenteditableResult.prosemirrorText, /906 W 2ND AVE/);
assert.doesNotMatch(contenteditableResult.prosemirrorText, /SPOKANE, WA 99201-4540/);

console.log("Content script runtime test passed.");
