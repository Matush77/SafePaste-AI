// Release gate: redaction quality must not fall below tests/eval/baseline.json.
// When a change improves scores, run `npm run eval:update-baseline` and commit
// the new baseline with it. Run `npm run eval -- --verbose` to see details.
import { describe, expect, it } from "vitest";
import { findRegressions, readBaseline } from "./baseline.js";
import { loadCorpus } from "./corpus.js";
import { scoreCorpus } from "./score.js";

describe("evaluation corpus", () => {
  const samples = loadCorpus();

  it("loads with valid labels", () => {
    expect(samples.length).toBeGreaterThan(100);
    expect(samples.some((sample) => sample.benign)).toBe(true);
  });

  it("scores no worse than the baseline", () => {
    const baseline = readBaseline();
    expect(baseline, "tests/eval/baseline.json is missing; run npm run eval:update-baseline").not.toBeNull();
    expect(findRegressions(scoreCorpus(samples), /** @type {any} */ (baseline))).toEqual([]);
  });
});
