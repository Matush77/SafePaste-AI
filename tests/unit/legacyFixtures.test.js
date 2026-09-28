// The benchmarks that existed before the evaluation suite, kept as offline
// regression checks: every listed sensitive value must be gone after redaction.
// They only measure leaks, not false positives; tests/eval covers both.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeSettings, redact } from "../../src/redactor.js";

const settings = mergeSettings({
  categories: { ...mergeSettings().categories, urls: true }
});

/** @param {string} name */
function load(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/legacy/${name}`, import.meta.url), "utf8"));
}

const SUITES = [
  "paste-scenarios.json",
  "unbiased-50.json",
  "public-contact-pages.json",
  "public-contact-samples.json",
  "contact-block.json"
];

describe.each(SUITES)("%s", (suite) => {
  /** @type {{ id: string, text: string, sensitive: string[] }[]} */
  const samples = load(suite);

  it.each(samples.map((sample) => [sample.id, sample]))("%s leaks nothing", (_id, sample) => {
    const { text } = redact(sample.text, settings);
    expect(sample.sensitive.filter((value) => text.includes(value))).toEqual([]);
  });
});

describe("scraped-contact-values.json", () => {
  /** @type {{ candidates: { type: string, value: string }[] }} */
  const { candidates } = load("scraped-contact-values.json");

  it.each(candidates.map((candidate) => [candidate.value, candidate]))("%s is redacted", (_value, candidate) => {
    expect(redact(`Value: ${candidate.value}`, settings).text).not.toContain(candidate.value);
  });
});
