// Compares an evaluation report against the accepted scores in baseline.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BASELINE_PATH = fileURLToPath(new URL("./baseline.json", import.meta.url));
export const HOLDOUT_BASELINE_PATH = fileURLToPath(new URL("./baseline-holdout.json", import.meta.url));

// Scores are rounded to 4 decimals; ignore differences below that.
const TOLERANCE = 0.00005;

/**
 * @typedef {import("./score.js").Report} Report
 * @typedef {{ overall: Report["overall"], recallByCategory: Record<string, number>, precisionByCategory: Record<string, number>, counts: Report["counts"] }} Baseline
 */

/**
 * @param {Report} report
 * @returns {Baseline}
 */
export function toBaseline(report) {
  return {
    overall: report.overall,
    recallByCategory: Object.fromEntries(Object.entries(report.recallByCategory).map(([key, stats]) => [key, stats.recall])),
    precisionByCategory: Object.fromEntries(Object.entries(report.precisionByCategory).map(([key, stats]) => [key, stats.precision])),
    counts: report.counts
  };
}

/**
 * @param {string} [path]
 * @returns {Baseline | null}
 */
export function readBaseline(path = BASELINE_PATH) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/**
 * @param {Report} report
 * @param {string} [path]
 */
export function writeBaseline(report, path = BASELINE_PATH) {
  writeFileSync(path, `${JSON.stringify(toBaseline(report), null, 2)}\n`);
}

/**
 * Lists every score that got worse than the baseline.
 * @param {Report} report
 * @param {Baseline} baseline
 * @returns {string[]}
 */
export function findRegressions(report, baseline) {
  const current = toBaseline(report);
  const regressions = [];

  /**
   * @param {string} name
   * @param {number | undefined} before
   * @param {number | undefined} after
   * @param {boolean} [lowerIsBetter]
   */
  const check = (name, before, after, lowerIsBetter = false) => {
    if (before === undefined || after === undefined) {
      return;
    }
    const worse = lowerIsBetter ? after - before : before - after;
    if (worse > TOLERANCE) {
      regressions.push(`${name}: ${format(before)} -> ${format(after)}`);
    }
  };

  check("overall recall", baseline.overall.recall, current.overall.recall);
  check("overall precision", baseline.overall.precision, current.overall.precision);
  check("overall F1", baseline.overall.f1, current.overall.f1);
  check("benign samples unchanged", baseline.overall.benignUnchanged, current.overall.benignUnchanged);
  check("leaked character rate", baseline.overall.leakedCharRate, current.overall.leakedCharRate, true);
  for (const [category, before] of Object.entries(baseline.recallByCategory)) {
    check(`${category} recall`, before, current.recallByCategory[category]);
  }
  for (const [category, before] of Object.entries(baseline.precisionByCategory)) {
    check(`${category} precision`, before, current.precisionByCategory[category]);
  }

  return regressions;
}

/** @param {number} value */
function format(value) {
  return `${(value * 100).toFixed(1)}%`;
}
