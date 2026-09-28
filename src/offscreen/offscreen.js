// Offscreen document: hosts the local name-detection model. Service workers
// cannot load the ONNX runtime (it imports code dynamically), so the model
// lives here and the background worker forwards requests to it.
//
// Privacy: only the model files are downloaded (from Hugging Face, once, then
// cached by the browser). Pasted text is processed here and never sent anywhere.

import { env, pipeline } from "@huggingface/transformers";
import { nerCandidates } from "../ner/ner.js";
import { MESSAGES, NAME_MODEL_DTYPE, NAME_MODEL_ID, NAME_MODEL_MIN_SCORE, OFFSCREEN_TARGET } from "../shared/nameModel.js";

/** @typedef {import("../shared/nameModel.js").NameModelStatus} NameModelStatus */

env.allowLocalModels = false;
env.useBrowserCache = true;
// The runtime's WebAssembly ships inside the extension; nothing executable
// is fetched from the network. Extension pages are not cross-origin
// isolated, so the runtime runs single-threaded.
const onnx = /** @type {any} */ (env.backends.onnx);
onnx.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL("ort/ort-wasm-simd-threaded.mjs"),
  wasm: chrome.runtime.getURL("ort/ort-wasm-simd-threaded.wasm")
};
onnx.wasm.numThreads = 1;
onnx.wasm.proxy = false;

/** @type {Promise<(text: string) => Promise<any>> | null} */
let classifierPromise = null;
/** @type {NameModelStatus} */
let status = { state: "absent" };

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== OFFSCREEN_TARGET) {
    return false;
  }
  handle(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error && error.message ? error.message : error) }));
  return true;
});

/** @param {{ type: string, text?: string }} message */
async function handle(message) {
  switch (message.type) {
    case MESSAGES.status:
      return { status };
    case MESSAGES.prepare:
      loadClassifier().catch(() => {});
      return { status };
    case MESSAGES.detect: {
      const classify = await loadClassifier();
      const candidates = await nerCandidates(classify, message.text || "", { minScore: NAME_MODEL_MIN_SCORE });
      return { candidates };
    }
    default:
      return { error: `Unknown message ${message.type}` };
  }
}

function loadClassifier() {
  if (!classifierPromise) {
    classifierPromise = createClassifier().catch((error) => {
      classifierPromise = null;
      setStatus({ state: "error", error: String(error && error.message ? error.message : error) });
      throw error;
    });
  }
  return classifierPromise;
}

async function createClassifier() {
  /** @type {Map<string, { loaded: number, total: number }>} */
  const files = new Map();
  setStatus({ state: "loading" });

  const classifier = await pipeline("token-classification", NAME_MODEL_ID, {
    dtype: /** @type {any} */ (NAME_MODEL_DTYPE),
    device: "wasm",
    progress_callback: (/** @type {any} */ event) => {
      if (event.status === "progress" && event.total) {
        files.set(event.file, { loaded: event.loaded, total: event.total });
        let loaded = 0;
        let total = 0;
        for (const file of files.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        setStatus({ state: "downloading", progress: Math.round((loaded / total) * 100) });
      }
    }
  });

  // Offscreen documents only have chrome.runtime; the background worker
  // records the download when it sees this status.
  setStatus({ state: "ready" });
  return (/** @type {string} */ text) => classifier(text, { ignore_labels: [] });
}

/** @param {NameModelStatus} next */
function setStatus(next) {
  status = next;
  chrome.runtime.sendMessage({ type: MESSAGES.progress, status }).catch(() => {
    // Nobody is listening (popup closed); that is fine.
  });
}
