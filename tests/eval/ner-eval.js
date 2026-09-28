// Compares rules alone with rules + a local NER model on every evaluation set.
// Downloads the model from Hugging Face into the transformers.js cache on
// first use.
//
//   npm run eval:ner -- [--model onnx-community/distilbert-NER-ONNX] [--dtype q8] [--min-score 0.85] [--verbose]
//
// Also fills the local model cache that the end-to-end test serves the
// model from.

import { pipeline } from "@huggingface/transformers";
import { detect } from "../../src/redactor.js";
import { nerCandidates } from "../../src/ner/ner.js";
import { CORPUS_DIR, HOLDOUT_DIR, loadCorpus } from "./corpus.js";
import { scoreCorpus } from "./score.js";

const args = process.argv.slice(2);
const option = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const modelId = option("--model", "onnx-community/distilbert-NER-ONNX");
const dtype = option("--dtype", "q8");
const minScore = Number(option("--min-score", "0.85"));
const verbose = args.includes("--verbose");

const classifier = await pipeline("token-classification", modelId, { dtype: /** @type {any} */ (dtype) });
/** @param {string} text */
const classify = async (text) => /** @type {any} */ (await classifier(text, { ignore_labels: [] }));

const sets = {
  "main corpus": loadCorpus(CORPUS_DIR),
  "held-out": loadCorpus(HOLDOUT_DIR).filter((sample) => !sample.file.includes("names")),
  "held-out names": loadCorpus(HOLDOUT_DIR).filter((sample) => sample.file.includes("names"))
};

const pct = (/** @type {number} */ value) => `${(value * 100).toFixed(1)}%`;
let inferenceMs = 0;
let inferenceChars = 0;

console.log(`\nModel ${modelId} (${dtype}), min score ${minScore}\n`);
for (const [name, samples] of Object.entries(sets)) {
  /** @type {Map<string, import("../../src/detection/util.js").Candidate[]>} */
  const extra = new Map();
  for (const sample of samples) {
    const started = performance.now();
    extra.set(sample.text, await nerCandidates(classify, sample.text, { minScore }));
    inferenceMs += performance.now() - started;
    inferenceChars += sample.text.length;
  }

  const rules = scoreCorpus(samples);
  const withNer = scoreCorpus(samples, undefined, (text, settings) => detect(text, settings, extra.get(text)));
  console.log(`${name}:`);
  console.table({
    "rules only": summarise(rules),
    "rules + model": summarise(withNer)
  });
  if (verbose) {
    const before = new Set(rules.falsePositives.map((fp) => `${fp.id}|${fp.value}`));
    for (const fp of withNer.falsePositives.filter((item) => !before.has(`${item.id}|${item.value}`))) {
      console.log(`  new false positive [${fp.type}] ${fp.id}: ${JSON.stringify(fp.value)}`);
    }
    const missedBefore = new Set(rules.misses.map((miss) => `${miss.id}|${miss.value}`));
    for (const miss of withNer.misses) {
      console.log(`  ${missedBefore.has(`${miss.id}|${miss.value}`) ? "still missed" : "NEW MISS"} [${miss.category}] ${miss.id}: ${JSON.stringify(miss.value)}`);
    }
  }
}
console.log(`Inference: ${(inferenceMs / 1000).toFixed(1)} s for ${inferenceChars} characters (${((inferenceMs / inferenceChars) * 1000).toFixed(0)} ms per 1000 characters)`);

/** @param {import("./score.js").Report} report */
function summarise(report) {
  const people = report.recallByCategory.people;
  return {
    recall: pct(report.overall.recall),
    precision: pct(report.overall.precision),
    "people recall": people ? `${people.caught}/${people.total}` : "-",
    "false positives": report.falsePositives.length,
    "benign unchanged": pct(report.overall.benignUnchanged)
  };
}

