// Prints redaction quality against the labelled corpus.
//
//   npm run eval                        report and compare with the baseline
//   npm run eval -- --verbose           also list every miss and false positive
//   npm run eval:update-baseline        accept the current scores as the new baseline
//
// Exits with code 1 if any score is worse than the baseline.

import { findRegressions, readBaseline, writeBaseline } from "./baseline.js";
import { loadCorpus } from "./corpus.js";
import { scoreCorpus } from "./score.js";

const args = new Set(process.argv.slice(2));
const report = scoreCorpus(loadCorpus());
const baseline = readBaseline();
const pct = (/** @type {number} */ value) => `${(value * 100).toFixed(1)}%`;

console.log(`\nCorpus: ${report.counts.labelled} labelled samples (${report.counts.goldSpans} sensitive values), ${report.counts.benign} benign samples\n`);

console.table({
  recall: pct(report.overall.recall),
  precision: pct(report.overall.precision),
  F1: pct(report.overall.f1),
  "leaked characters": pct(report.overall.leakedCharRate),
  "benign samples unchanged": pct(report.overall.benignUnchanged)
});

console.log("Recall by labelled category (caught = fully redacted):");
console.table(Object.fromEntries(Object.entries(report.recallByCategory).map(([category, stats]) => [
  category,
  { caught: `${stats.caught}/${stats.total}`, partial: stats.partial, recall: pct(stats.recall), baseline: baseline ? pct(baseline.recallByCategory[category] ?? NaN) : "-" }
])));

console.log("Precision by detector category (false positive = redacted text that is not sensitive):");
console.table(Object.fromEntries(Object.entries(report.precisionByCategory).map(([category, stats]) => [
  category,
  { redactions: stats.total, "false positives": stats.falsePositives, precision: pct(stats.precision), baseline: baseline ? pct(baseline.precisionByCategory[category] ?? NaN) : "-" }
])));

if (args.has("--verbose")) {
  console.log("\nMisses (sensitive text that reached the page):");
  for (const miss of report.misses) {
    console.log(`  [${miss.category}] ${miss.id}: ${JSON.stringify(miss.value)} leaked ${JSON.stringify(miss.leaked)}`);
  }
  console.log("\nFalse positives:");
  for (const fp of report.falsePositives) {
    console.log(`  [${fp.type}] ${fp.id}: ${JSON.stringify(fp.value)}`);
  }
} else {
  console.log(`${report.misses.length} misses and ${report.falsePositives.length} false positives. Run with --verbose to list them.`);
}

if (args.has("--update-baseline")) {
  writeBaseline(report);
  console.log("\nBaseline updated. Commit tests/eval/baseline.json with the change that moved the scores.");
} else if (!baseline) {
  console.log("\nNo baseline yet. Run `npm run eval:update-baseline` to create one.");
} else {
  const regressions = findRegressions(report, baseline);
  if (regressions.length) {
    console.error(`\nWorse than baseline:\n  ${regressions.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nNo score is worse than the baseline.");
  }
}
