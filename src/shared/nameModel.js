// The optional local name-detection model and the messages used to reach it.
// Content script / popup -> background service worker -> offscreen document.

// English NER model (DistilBERT fine-tuned on CoNLL-2003), 8-bit, ~66 MB.
// Chosen by tests/eval/ner-eval.js: best precision/recall trade-off on
// English text among the models compared.
export const NAME_MODEL_ID = "onnx-community/distilbert-NER-ONNX";
export const NAME_MODEL_DTYPE = "q8";
export const NAME_MODEL_SIZE_MB = 66;
// Mean token score an entity needs (see src/ner/ner.js).
export const NAME_MODEL_MIN_SCORE = 0.85;

// chrome.storage.local key recording that the model was downloaded once.
export const NAME_MODEL_READY_KEY = "nameModelDownloaded";

export const MESSAGES = /** @type {const} */ ({
  // To the background worker.
  detect: "nameModel:detect", // { text } -> { candidates } | { error }
  prepare: "nameModel:prepare", // start loading/downloading -> { status }
  status: "nameModel:status", // -> { status }
  // Broadcast by the offscreen document while loading.
  progress: "nameModel:progress" // { status }
});

// Messages the background forwards to the offscreen document carry this target.
export const OFFSCREEN_TARGET = "safepaste-offscreen";

/**
 * @typedef {object} NameModelStatus
 * @property {"absent" | "downloaded" | "downloading" | "loading" | "ready" | "error"} state
 *   "downloaded": on disk from an earlier session but not loaded yet.
 * @property {number} [progress] 0-100 while downloading.
 * @property {string} [error]
 */
