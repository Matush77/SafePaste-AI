// Redaction runs inside the paste handler, so a slow regular expression
// freezes the page. These inputs once made individual patterns backtrack for
// seconds to minutes; each must now finish well within the budget.
import { describe, expect, it } from "vitest";
import { detect } from "../../src/redactor.js";

// Generous so slow CI machines pass; the real numbers are ~10-150 ms.
const BUDGET_MS = 2000;

const ADVERSARIAL = {
  "unbroken capitalised letters": "Abcdef".repeat(20000),
  "one repeated character (base64 blob)": "A".repeat(100000),
  "dash-separated digits": "12-".repeat(20000),
  "space-separated digits": "1 ".repeat(20000),
  "'a dot a dot' chains": "a dot ".repeat(20000),
  "'x at y dot' chains": "x at y dot ".repeat(10000),
  "capitalised words": "Aa ".repeat(20000),
  "comma lists": "Word, ".repeat(20000),
  "colon runs": "ab:".repeat(20000),
  "at signs": "a@".repeat(20000),
  "URL without end": `https://${"a".repeat(100000)}`,
  "URL full of @": `https://${"a@".repeat(20000)}`,
  "assignments": "key=".repeat(20000),
  "unterminated JSON strings": "\"password\": \"".repeat(10000),
  "dotted numbers": "1.2.3.4.".repeat(10000),
  "house numbers and words": "12 Main ".repeat(10000),
  "unterminated private key": `-----BEGIN RSA PRIVATE KEY-----\n${"QUJDREVGR0hJSktMTU5PUA==\n".repeat(5000)}`
};

describe("redaction speed", () => {
  it.each(Object.entries(ADVERSARIAL))("handles %s quickly", (_name, text) => {
    const started = performance.now();
    detect(text);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  });

  it("handles a 200 KB realistic paste quickly", () => {
    const block = [
      "From: Rebecca Thornton <rthornton82@gmail.com>",
      "Ship to 4417 Maple Ridge Dr, Columbus, OH 43215 or call (614) 555-0187.",
      "const token = getToken();",
      "OPENAI_API_KEY=sk-proj-8fJ2kLmN4pQrS7tUvWxYz0aBcDeFgHiJkLmNoPqRsTuV",
      "SELECT id, total FROM orders WHERE created_at >= '2024-01-01';"
    ].join("\n");
    const text = block.repeat(Math.ceil(200000 / block.length));
    const started = performance.now();
    const matches = detect(text);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    expect(matches.length).toBeGreaterThan(0);
  });
});
