// Manual paste harness. Build with `npm run build:harness`, serve the repo
// root, and open dist/harness/index.html.
import CASES from "../fixtures/legacy/paste-scenarios.json";
import { mergeSettings, redact } from "../../src/redactor.js";
import { editableFromEvent, insertText } from "../../src/siteAdapters.js";

const settings = mergeSettings({
  categories: {
    urls: true
  }
});

const casesEl = document.getElementById("cases");
const sourceEl = document.getElementById("source");
const editorEl = document.getElementById("editor");
const resultEl = document.getElementById("result");
const redactedEl = document.getElementById("redacted");
const copyCaseEl = document.getElementById("copyCase");
const clearEl = document.getElementById("clear");

let selected = CASES[0];
window.pasteHarnessCases = CASES;
window.pasteHarnessLastResult = null;

renderCases();
selectCase(selected.id);

document.addEventListener("paste", onPaste, true);
copyCaseEl.addEventListener("click", async () => {
  await navigator.clipboard.writeText(selected.text);
});
clearEl.addEventListener("click", clearEditor);

function renderCases() {
  casesEl.textContent = "";
  for (const testCase of CASES) {
    const button = document.createElement("button");
    button.className = "case";
    button.type = "button";
    button.dataset.caseId = testCase.id;
    const title = document.createElement("strong");
    title.textContent = testCase.title;
    const expected = document.createElement("span");
    expected.textContent = testCase.expect.length ? testCase.expect.join(", ") : "No redaction expected";
    button.append(title, expected);
    button.addEventListener("click", () => selectCase(testCase.id));
    casesEl.append(button);
  }
}

function selectCase(id) {
  selected = CASES.find((testCase) => testCase.id === id) || CASES[0];
  sourceEl.textContent = selected.text;

  for (const button of casesEl.querySelectorAll(".case")) {
    button.setAttribute("aria-selected", String(button.dataset.caseId === selected.id));
  }
}

function clearEditor() {
  editorEl.textContent = "";
  redactedEl.textContent = "";
  resultEl.textContent = "No paste yet.";
  window.pasteHarnessLastResult = null;
}

function onPaste(event) {
  const editable = editableFromEvent(event);
  if (editable !== editorEl) {
    return;
  }

  const plainText = event.clipboardData && event.clipboardData.getData("text/plain");
  if (!plainText) {
    return;
  }

  const result = redact(plainText, settings);
  event.preventDefault();
  event.stopImmediatePropagation();
  insertText(editable, result.text);

  const expectation = evaluateExpectation(selected, result);
  window.pasteHarnessLastResult = {
    caseId: selected.id,
    changed: result.changed,
    text: result.text,
    findings: result.findings,
    expectation
  };

  renderResult(window.pasteHarnessLastResult);
}

function evaluateExpectation(testCase, result) {
  const types = new Set(result.findings.map((finding) => finding.type));
  const missingTypes = testCase.expect.filter((type) => !types.has(type));
  const leakedValues = testCase.sensitive.filter((value) => result.text.includes(value));
  return {
    passed: missingTypes.length === 0 && leakedValues.length === 0 && (testCase.expect.length > 0 ? result.changed : !result.changed),
    missingTypes,
    leakedValues
  };
}

function renderResult(result) {
  const status = document.createElement("div");
  status.className = result.expectation.passed ? "pass" : "fail";
  status.textContent = result.expectation.passed ? "PASS" : "FAIL";

  const details = document.createElement("div");
  const counts = result.findings.reduce((acc, finding) => {
    acc[finding.type] = (acc[finding.type] || 0) + 1;
    return acc;
  }, {});
  details.textContent = Object.keys(counts).length
    ? Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(", ")
    : "No findings";

  resultEl.textContent = "";
  resultEl.append(status, details);
  redactedEl.textContent = result.text;
}
