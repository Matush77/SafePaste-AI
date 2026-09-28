// Release gate: redaction quality must not fall below tests/eval/baseline.json.
// When a change improves scores, run `npm run eval:update-baseline` and commit
// the new baseline with it. Run `npm run eval -- --verbose` to see details.
import { describe, expect, it } from "vitest";
import { BASELINE_PATH, HOLDOUT_BASELINE_PATH, findRegressions, readBaseline } from "./baseline.js";
import { CORPUS_DIR, HOLDOUT_DIR, loadCorpus } from "./corpus.js";
import { scoreCorpus } from "./score.js";

describe.each([
  ["main corpus", CORPUS_DIR, BASELINE_PATH],
  ["held-out set", HOLDOUT_DIR, HOLDOUT_BASELINE_PATH]
])("%s", (_name, dir, baselinePath) => {
  const samples = loadCorpus(dir);

  it("loads with valid labels", () => {
    expect(samples.some((sample) => sample.benign)).toBe(true);
    expect(samples.some((sample) => !sample.benign)).toBe(true);
  });

  it("scores no worse than the baseline", () => {
    const baseline = readBaseline(baselinePath);
    expect(baseline, `${baselinePath} is missing; run npm run eval:update-baseline`).not.toBeNull();
    expect(findRegressions(scoreCorpus(samples), /** @type {any} */ (baseline))).toEqual([]);
  });
});
