// Scores the engine on public labelled PII datasets (see datasets.js).
// These texts were written by others, so the numbers are an independent check
// on the in-house corpus. Not part of the test gate: it needs the network the
// first time, and the datasets are not stored in the repository.
//
//   npm run eval:external                  development set (rows 0-499)
//   npm run eval:external -- --verbose     ...and list misses and false positives
//   npm run eval:external -- --test        untouched test set (rows 1000-1499), totals only

import { loadDataset } from "./datasets.js";
import { scoreCorpus } from "../score.js";

const args = process.argv.slice(2);
const set = args.includes("--test") ? "test" : "dev";
const verbose = args.includes("--verbose");
if (set === "test" && verbose) {
  console.error("The test set only reports totals; inspect misses on the development set instead.");
  process.exit(1);
}
const pct = (/** @type {number} */ value) => `${(value * 100).toFixed(1)}%`;

for (const name of /** @type {const} */ (["nemotron", "gretel"])) {
  const samples = await loadDataset(name, set);
  const report = scoreCorpus(samples);

  console.log(`\n${name}: ${samples.length} documents, ${report.counts.goldSpans} labelled values in scope`);
  console.table({
    recall: pct(report.overall.recall),
    precision: pct(report.overall.precision),
    F1: pct(report.overall.f1),
    "leaked characters": pct(report.overall.leakedCharRate)
  });
  console.table(Object.fromEntries(Object.entries(report.recallByCategory).map(([category, stats]) => [
    category,
    {
      caught: `${stats.caught}/${stats.total}`,
      recall: pct(stats.recall),
      precision: report.precisionByCategory[category] ? pct(report.precisionByCategory[category].precision) : "-"
    }
  ])));

  if (verbose) {
    const byCategory = /** @type {Record<string, string[]>} */ ({});
    for (const miss of report.misses) {
      (byCategory[miss.category] ||= []).push(miss.value);
    }
    for (const [category, values] of Object.entries(byCategory)) {
      console.log(`  missed ${category} (${values.length}), e.g. ${values.slice(0, 12).map((value) => JSON.stringify(value)).join(", ")}`);
    }
    const fpByType = /** @type {Record<string, string[]>} */ ({});
    for (const fp of report.falsePositives) {
      (fpByType[fp.type] ||= []).push(fp.value);
    }
    for (const [type, values] of Object.entries(fpByType)) {
      console.log(`  false positive ${type} (${values.length}), e.g. ${values.slice(0, 8).map((value) => JSON.stringify(value)).join(", ")}`);
    }
  }
}
