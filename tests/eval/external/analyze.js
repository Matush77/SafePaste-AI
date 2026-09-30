// Error analysis on the external DEVELOPMENT sets (rows 0-499) only: misses
// grouped by the dataset's original label, and false positives by type, with
// the surrounding text. Never run this on the test set.
//
//   npm run eval:analyze                      counts per label and type
//   npm run eval:analyze -- gretel:ssn        examples for one label
//   npm run eval:analyze -- fp:PERSON 40      false positive examples

import { detect } from "../../../src/redactor.js";
import { loadDataset } from "./datasets.js";

const MEANINGFUL = /[\p{L}\p{N}]/u;
const [filter, limitArg] = process.argv.slice(2);
const limit = Number(limitArg || 25);

/** @type {Record<string, string[]>} */
const misses = {};
/** @type {Record<string, string[]>} */
const falsePositives = {};

/**
 * @param {string} text
 * @param {number} start
 * @param {number} end
 */
const context = (text, start, end) =>
  `${text.slice(Math.max(0, start - 45), start)}⟦${text.slice(start, end)}⟧${text.slice(end, end + 25)}`.replace(/\s+/g, " ");

for (const name of /** @type {const} */ (["nemotron", "gretel"])) {
  for (const sample of await loadDataset(name, "dev")) {
    const predicted = detect(sample.text);
    const covered = new Uint8Array(sample.text.length);
    for (const match of predicted) {
      covered.fill(1, match.start, match.end);
    }
    for (const span of sample.gold) {
      for (let i = span.start; i < span.end; i += 1) {
        if (!covered[i] && MEANINGFUL.test(sample.text[i])) {
          (misses[`${name}:${span.label}`] ||= []).push(context(sample.text, span.start, span.end));
          break;
        }
      }
    }

    const inGold = new Uint8Array(sample.text.length);
    for (const span of sample.gold) {
      inGold.fill(1, span.start, span.end);
    }
    const inNeutral = new Uint8Array(sample.text.length);
    for (const span of sample.neutral || []) {
      inNeutral.fill(1, span.start, span.end);
    }
    for (const match of predicted) {
      let hitsGold = false;
      let hitsNeutral = false;
      for (let i = match.start; i < match.end; i += 1) {
        if (MEANINGFUL.test(sample.text[i])) {
          hitsGold ||= inGold[i] === 1;
          hitsNeutral ||= inNeutral[i] === 1;
        }
      }
      if (!hitsGold && !hitsNeutral) {
        (falsePositives[`${name}:${match.type}`] ||= []).push(context(sample.text, match.start, match.end));
      }
    }
  }
}

if (filter) {
  const groups = filter.startsWith("fp:") ? falsePositives : misses;
  const wanted = filter.replace(/^fp:/, "");
  for (const [key, examples] of Object.entries(groups)) {
    if (key.includes(wanted)) {
      console.log(`== ${key} (${examples.length})`);
      for (const example of examples.slice(0, limit)) {
        console.log(`  ${example}`);
      }
    }
  }
} else {
  console.log("Misses by label:");
  for (const [key, examples] of Object.entries(misses).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(examples.length).padStart(5)} ${key}`);
  }
  console.log("\nFalse positives by type:");
  for (const [key, examples] of Object.entries(falsePositives).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(examples.length).padStart(5)} ${key}`);
  }
}
