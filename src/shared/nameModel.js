// The optional local name-detection model and the messages used to reach it.
// Content script / popup -> background service worker -> offscreen document.

// English NER model (DistilBERT fine-tuned on CoNLL-2003), 8-bit, ~66 MB.
// Chosen by tests/eval/ner-eval.js: best precision/recall trade-off on
// English text among the models compared.
export const NAME_MODEL_ID = "onnx-community/distilbert-NER-ONNX";
// Pinned: the model repository can change, the extension only loads these
// exact files (checked by src/ner/verifiedFetch.js).
export const NAME_MODEL_REVISION = "3a19fe9404a4469d91aa3d551558a97f68872f67";
/** @type {Record<string, { sha256: string, size: number }>} */
export const NAME_MODEL_FILES = {
  "config.json": { sha256: "f109facddb205dac712adf5877e4315fae62041bc0916fe808d92abdb594d1fe", size: 965 },
  "tokenizer.json": { sha256: "cb26b43c98e8266ae3e99c2a583cf8315d73b33a17e6b20b4df7ff1f22392d34", size: 669021 },
  "tokenizer_config.json": { sha256: "3c02f7e3bd40e2aca0235ca42256609fd0cd7d883226e17ddea667f1b1314665", size: 1335 },
  "onnx/model_quantized.onnx": { sha256: "9419a876387ff2bbe5f21ab7429c7bef93eac86c50353390d4d8fca6e4a210d8", size: 65772734 }
};
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
