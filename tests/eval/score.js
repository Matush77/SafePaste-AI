// Scores detector output against the labelled corpus.
//
// A gold span is "caught" only if every letter and digit in it is inside a
// predicted span. A predicted span is a false positive if it covers no letter
// or digit of any gold span. See GUIDELINES.md.

import { detect } from "../../src/redactor.js";

/**
 * @typedef {import("./corpus.js").Sample} Sample
 * @typedef {import("./corpus.js").GoldSpan} GoldSpan
 * @typedef {import("../../src/redactor.js").Match} Match
 * @typedef {import("../../src/redactor.js").Settings} Settings
 *
 * @typedef {{ total: number, caught: number, partial: number, recall: number }} RecallStats
 * @typedef {{ total: number, falsePositives: number, precision: number }} PrecisionStats
 *
 * @typedef {object} Report
 * @property {{ recall: number, precision: number, f1: number, leakedCharRate: number, benignUnchanged: number }} overall
 * @property {Record<string, RecallStats>} recallByCategory
 * @property {Record<string, PrecisionStats>} precisionByCategory
 * @property {{ samples: number, labelled: number, benign: number, goldSpans: number, predictions: number }} counts
 * @property {{ id: string, category: string, value: string, leaked: string }[]} misses
 * @property {{ id: string, category: string, type: string, value: string }[]} falsePositives
 */

const MEANINGFUL = /[\p{L}\p{N}]/u;

/**
 * @param {Sample[]} samples
 * @param {Partial<Settings>} [settings]
 * @param {(text: string, settings?: Partial<Settings>) => Match[]} [detector] Defaults to the real engine.
 * @returns {Report}
 */
export function scoreCorpus(samples, settings, detector = detect) {
  /** @type {Record<string, RecallStats>} */
  const recallByCategory = {};
  /** @type {Record<string, PrecisionStats>} */
  const precisionByCategory = {};
  /** @type {Report["misses"]} */
  const misses = [];
  /** @type {Report["falsePositives"]} */
  const falsePositives = [];

  let goldSpans = 0;
  let caughtSpans = 0;
  let meaningfulGoldChars = 0;
  let leakedGoldChars = 0;
  let predictions = 0;
  let truePredictions = 0;
  let benignSamples = 0;
  let benignUnchanged = 0;

  for (const sample of samples) {
    const predicted = detector(sample.text, settings);
    const covered = new Uint8Array(sample.text.length);
    for (const match of predicted) {
      covered.fill(1, match.start, match.end);
    }
    const inGold = new Uint8Array(sample.text.length);
    for (const span of sample.gold) {
      inGold.fill(1, span.start, span.end);
    }

    for (const span of sample.gold) {
      const stats = (recallByCategory[span.category] ||= { total: 0, caught: 0, partial: 0, recall: 0 });
      stats.total += 1;
      goldSpans += 1;

      let meaningful = 0;
      let leaked = "";
      let coveredCount = 0;
      for (let i = span.start; i < span.end; i += 1) {
        if (!MEANINGFUL.test(sample.text[i])) {
          continue;
        }
        meaningful += 1;
        if (covered[i]) {
          coveredCount += 1;
        } else {
          leaked += sample.text[i];
        }
      }
      meaningfulGoldChars += meaningful;
      leakedGoldChars += meaningful - coveredCount;

      if (coveredCount === meaningful) {
        stats.caught += 1;
        caughtSpans += 1;
      } else {
        if (coveredCount > 0) {
          stats.partial += 1;
        }
        misses.push({ id: sample.id, category: span.category, value: span.value, leaked });
      }
    }

    for (const match of predicted) {
      const stats = (precisionByCategory[match.category] ||= { total: 0, falsePositives: 0, precision: 0 });
      stats.total += 1;
      predictions += 1;

      let hitsGold = false;
      for (let i = match.start; i < match.end && !hitsGold; i += 1) {
        hitsGold = inGold[i] === 1 && MEANINGFUL.test(sample.text[i]);
      }
      if (hitsGold) {
        truePredictions += 1;
      } else {
        stats.falsePositives += 1;
        falsePositives.push({ id: sample.id, category: match.category, type: match.type, value: match.value });
      }
    }

    if (sample.gold.length === 0) {
      benignSamples += 1;
      if (predicted.length === 0) {
        benignUnchanged += 1;
      }
    }
  }

  for (const stats of Object.values(recallByCategory)) {
    stats.recall = ratio(stats.caught, stats.total);
  }
  for (const stats of Object.values(precisionByCategory)) {
    stats.precision = ratio(stats.total - stats.falsePositives, stats.total);
  }

  const recall = ratio(caughtSpans, goldSpans);
  const precision = ratio(truePredictions, predictions);

  return {
    overall: {
      recall,
      precision,
      f1: recall + precision === 0 ? 0 : round((2 * recall * precision) / (recall + precision)),
      leakedCharRate: ratio(leakedGoldChars, meaningfulGoldChars),
      benignUnchanged: ratio(benignUnchanged, benignSamples)
    },
    recallByCategory: sortKeys(recallByCategory),
    precisionByCategory: sortKeys(precisionByCategory),
    counts: {
      samples: samples.length,
      labelled: samples.length - benignSamples,
      benign: benignSamples,
      goldSpans,
      predictions
    },
    misses,
    falsePositives
  };
}

/**
 * @param {number} part
 * @param {number} whole
 */
function ratio(part, whole) {
  return whole === 0 ? 1 : round(part / whole);
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * @template T
 * @param {Record<string, T>} record
 * @returns {Record<string, T>}
 */
function sortKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
