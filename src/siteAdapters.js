(function () {
  "use strict";

  const SITES = {
    "chatgpt.com": {
      id: "chatgpt",
      name: "ChatGPT"
    },
    "gemini.google.com": {
      id: "gemini",
      name: "Gemini"
    },
    "claude.ai": {
      id: "claude",
      name: "Claude"
    }
  };

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
    ]
  };

  function currentSite() {
    const testSite = document.documentElement && document.documentElement.dataset.redactorTestSite;
    if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
      return SITES[testSite] || null;
    }

    return SITES[location.hostname] || null;
  }

  function editableFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (isEditable(node)) {
        return node;
      }
    }

    return deepestActiveEditable(document);
  }

  function promptEditableFromEvent(event, site) {
    const editable = editableFromEvent(event);
    if (!editable || !site) {
      return null;
    }

    return isPromptEditable(editable, site) ? editable : null;
  }

  function deepestActiveEditable(root) {
    let active = root.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return isEditable(active) ? active : null;
  }

  function isEditable(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const element = node;
    const tag = element.tagName;
    if (tag === "TEXTAREA") {
      return !element.disabled && !element.readOnly;
    }

    if (tag === "INPUT") {
      return false;
    }

    return Boolean(element.isContentEditable);
  }

  function isPromptEditable(editable, site) {
    if (editable.tagName === "INPUT") {
      return false;
    }

    if (editable.tagName === "TEXTAREA" && (editable.disabled || editable.readOnly)) {
      return false;
    }

    const selectors = PROMPT_SELECTORS[site.id] || [];
    return selectors.some((selector) => matchesSelfOrAncestor(editable, selector));
  }

  function matchesSelfOrAncestor(element, selector) {
    try {
      return Boolean(element.matches(selector) || element.closest(selector));
    } catch (_error) {
      return false;
    }
  }

  function insertText(editable, text) {
    if (!editable) {
      return false;
    }

    if (editable.tagName === "TEXTAREA" || editable.tagName === "INPUT") {
      insertIntoInput(editable, text);
      return true;
    }

    editable.focus();
    if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
      const inserted = document.execCommand("insertText", false, text);
      if (inserted) {
        dispatchInput(editable, text);
        return true;
      }
    }

    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      editable.textContent += text;
      dispatchInput(editable, text);
      return true;
    }

    const range = selection.getRangeAt(0);
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

  function insertIntoInput(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(text, start, end, "end");
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: text
    }));
  }

  function dispatchInput(element, text) {
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: text
    }));
  }

  window.SensitivePasteSites = {
    currentSite,
    editableFromEvent,
    promptEditableFromEvent,
    insertText
  };
})();
