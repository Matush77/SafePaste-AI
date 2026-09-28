// Turning model token predictions into candidates, with a fake classifier.
import { describe, expect, it } from "vitest";
import { nerCandidates } from "../../src/ner/ner.js";
import { redact } from "../../src/redactor.js";

/**
 * A fake token classifier: tags the given words, in order, with a label.
 * Words are split into tokens on spaces; "Okonkwo" becomes "Ok", "##onk",
 * "##wo" when listed as ["Ok", "##onk", "##wo"].
 * @param {[string[], string, number?][]} entities  [tokens, label, score]
 */
function fakeClassifier(entities) {
  return async () => {
    const predictions = [];
    let index = 0;
    for (const [tokens, label, score = 0.99] of entities) {
      index += 2; // some untagged tokens in between
      tokens.forEach((word, position) => {
        const prefix = position === 0 || word.startsWith("##") ? "B" : "I";
        predictions.push({ entity: `${word.startsWith("##") ? "I" : prefix}-${label}`, score, index, word });
        index += 1;
      });
    }
    return predictions;
  };
}

/**
 * @param {string} text
 * @param {Awaited<ReturnType<typeof nerCandidates>>} candidates
 */
function spans(text, candidates) {
  return candidates.map((candidate) => text.slice(candidate.start, candidate.end));
}

describe("nerCandidates", () => {
  it("joins word pieces and multi-token names", async () => {
    const text = "but Adaeze Okonkwo still needs to sign off";
    const candidates = await nerCandidates(fakeClassifier([[["Ad", "##ae", "##ze", "Ok", "##onk", "##wo"], "PER"]]), text);
    expect(spans(text, candidates)).toEqual(["Adaeze Okonkwo"]);
    expect(candidates[0]).toMatchObject({ category: "people", type: "PERSON", source: "model" });
  });

  it("maps repeated names to each of their occurrences", async () => {
    const text = "ask Mia, then ask Mia again";
    const candidates = await nerCandidates(fakeClassifier([[["Mia"], "PER"], [["Mia"], "PER"]]), text);
    expect(candidates.map((candidate) => candidate.start)).toEqual([4, 18]);
  });

  it("drops low scores, acronyms, labels, greetings and code", async () => {
    const text = [
      "then Jonas Brenner called",
      "DOB: 1978-06-21",
      "Rodné číslo: 851203/4417",
      "Dobrý deň Petra Hudáka",
      "class OrderService { constructor(private Logger logger) {} }"
    ].join("\n");
    const candidates = await nerCandidates(fakeClassifier([
      [["Jonas", "Brenner"], "PER", 0.5],
      [["DOB"], "LOC"],
      [["Rodné", "číslo"], "PER"],
      [["Dobrý", "deň", "Petra", "Hudáka"], "PER"],
      [["OrderService"], "PER"]
    ]), text);
    expect(spans(text, candidates)).toEqual(["Petra Hudáka"]);
  });

  it("needs a very confident prediction for one word opening a sentence", async () => {
    const text = "Castling requires an unmoved king. Kowalski approved it.";
    const unsure = await nerCandidates(fakeClassifier([[["Castling"], "PER", 0.9], [["Kowalski"], "PER", 0.9]]), text);
    expect(unsure).toEqual([]);
    const sure = await nerCandidates(fakeClassifier([[["Kowalski"], "PER", 0.99]]), text);
    expect(spans(text, sure)).toEqual(["Kowalski"]);
  });

  it("keeps model organisations and places for strict mode only", async () => {
    const text = "Satya worked at Microsoft in Redmond";
    const candidates = await nerCandidates(fakeClassifier([[["Microsoft"], "ORG"], [["Redmond"], "LOC"]]), text);
    expect(candidates.map((candidate) => candidate.confidence)).toEqual(["low", "low"]);
    expect(redact(text, {}, candidates).text).toBe(text);
    expect(redact(text, { sensitivity: "strict" }, candidates).text).not.toContain("Microsoft");
  });

  it("does not let model names promote nearby place names", async () => {
    // "Paris" is only redacted near personal data found by the rules, not
    // near a name the model guessed.
    const text = "Lionel Messi scored twice in Paris";
    const candidates = await nerCandidates(fakeClassifier([[["Lionel", "Messi"], "PER"]]), text);
    expect(redact(text, {}, candidates).text).toContain("Paris");
  });
});
