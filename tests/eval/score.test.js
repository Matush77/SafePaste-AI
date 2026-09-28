import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRegressions, toBaseline } from "./baseline.js";
import { loadCorpus } from "./corpus.js";
import { scoreCorpus } from "./score.js";

/** @param {Record<string, string>} files */
function corpusFrom(files) {
  const dir = mkdtempSync(join(tmpdir(), "safepaste-corpus-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return loadCorpus(dir);
}

describe("loadCorpus", () => {
  it("strips labels and records gold spans at their final offsets", () => {
    const [sample] = corpusFrom({ "a.txt": "=== s1\nMail «emails:jo@example.com» or «phones:+1 415 555 0100».\n" });
    expect(sample.text).toBe("Mail jo@example.com or +1 415 555 0100.");
    expect(sample.gold.map((span) => sample.text.slice(span.start, span.end))).toEqual(["jo@example.com", "+1 415 555 0100"]);
  });

  it("rejects unknown categories, labels in benign files, and duplicate ids", () => {
    expect(() => corpusFrom({ "a.txt": "=== s1\n«secrets:x»\n" })).toThrow(/unknown category/);
    expect(() => corpusFrom({ "benign-a.txt": "=== s1\n«emails:jo@example.com»\n" })).toThrow(/contains labels/);
    expect(() => corpusFrom({ "a.txt": "=== s1\nx\n=== s1\ny\n" })).toThrow(/duplicate/);
  });
});

/**
 * A detector that redacts every occurrence of `needle`, for testing the
 * scorer independently of the real engine.
 * @param {string} needle
 */
function redactsEvery(needle) {
  return (/** @type {string} */ text) => {
    /** @type {import("../../src/redactor.js").Match[]} */
    const matches = [];
    for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) {
      matches.push({ start: index, end: index + needle.length, value: needle, type: "TEST", category: "credentials" });
    }
    return matches;
  };
}

describe("scoreCorpus", () => {
  it("counts a partly redacted value as a miss", () => {
    const samples = corpusFrom({ "a.txt": "=== s1\ntoken «apiKeys:npm_abcdefghijklmnopqrstuvwxyz0123456789»\n" });
    const report = scoreCorpus(samples, undefined, redactsEvery("0123456789"));
    expect(report.recallByCategory.apiKeys).toMatchObject({ total: 1, caught: 0, partial: 1 });
    expect(report.misses[0].leaked).toBe("npmabcdefghijklmnopqrstuvwxyz");
  });

  it("counts redactions in benign text as false positives", () => {
    const samples = corpusFrom({ "benign-a.txt": "=== s1\nconst token = getToken();\n" });
    const report = scoreCorpus(samples, undefined, redactsEvery("getToken"));
    expect(report.falsePositives).toHaveLength(1);
    expect(report.overall.benignUnchanged).toBe(0);
  });

  it("scores a fully redacted value as caught with no false positives", () => {
    const samples = corpusFrom({ "a.txt": "=== s1\nWrite to «emails:jo@example.com» today.\n" });
    const report = scoreCorpus(samples);
    expect(report.overall).toMatchObject({ recall: 1, precision: 1, leakedCharRate: 0 });
  });
});

describe("findRegressions", () => {
  it("flags a drop in recall when a detector is switched off", () => {
    const samples = loadCorpus();
    const baseline = toBaseline(scoreCorpus(samples));
    const worse = scoreCorpus(samples, { categories: { ...defaultCategories(), emails: false } });
    expect(findRegressions(worse, baseline)).toContain(`emails recall: ${pct(baseline.recallByCategory.emails)} -> 0.0%`);
  });

  it("reports nothing when scores are unchanged", () => {
    const report = scoreCorpus(loadCorpus());
    expect(findRegressions(report, toBaseline(report))).toEqual([]);
  });
});

function defaultCategories() {
  return {
    apiKeys: true, credentials: true, emails: true, phones: true, financial: true, governmentIds: true,
    network: true, addresses: true, people: true, organizations: true, locations: true, urls: false
  };
}

/** @param {number} value */
function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}
