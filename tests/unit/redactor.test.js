import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, redact } from "../../src/redactor.js";

describe("redact", () => {
  it("replaces common sensitive values with typed placeholders", () => {
    const input = [
      "Hi Dr. Jane Smith,",
      "email jane.smith@example.com",
      "phone +1 415-555-0199",
      "card 4111 1111 1111 1111",
      "key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
      "company Acme Labs Inc.",
      "address 123 Market Street"
    ].join(", ");

    const result = redact(input);

    expect(result.changed).toBe(true);
    for (const placeholder of ["PERSON_1", "EMAIL_1", "PHONE_1", "CREDIT_CARD_1", "OPENAI_API_KEY_1", "ORG_1", "ADDRESS_1"]) {
      expect(result.text).toContain(`[[${placeholder}]]`);
    }
    expect(result.text).not.toContain("Jane Smith");
    expect(result.text).not.toContain("jane.smith@example.com");
  });

  it("reuses the same placeholder for a repeated value", () => {
    const result = redact("Mail a@example.com, then a@example.com again, then b@example.com.");
    expect(result.text).toBe("Mail [[EMAIL_1]], then [[EMAIL_1]] again, then [[EMAIL_2]].");
  });

  it("reports the original span of each finding", () => {
    const text = "Contact jane@example.com today";
    const [finding] = redact(text).findings;
    expect(text.slice(finding.start, finding.end)).toBe("jane@example.com");
  });

  it("uses compact placeholders when configured", () => {
    expect(redact("x jane@example.com", { placeholderStyle: "compact" }).text).toBe("x [EMAIL_1]");
  });

  it("does nothing when disabled", () => {
    const result = redact("jane@example.com", { enabled: false });
    expect(result).toEqual({ text: "jane@example.com", changed: false, findings: [] });
  });

  it("skips disabled categories", () => {
    const result = redact("jane@example.com", mergeSettings({ categories: { ...DEFAULT_SETTINGS.categories, emails: false } }));
    expect(result.changed).toBe(false);
  });
});

describe("mergeSettings", () => {
  it("returns defaults for missing or malformed input", () => {
    expect(mergeSettings()).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(/** @type {any} */ ("garbage"))).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores unknown categories and non-boolean values", () => {
    const merged = mergeSettings(/** @type {any} */ ({
      enabled: "yes",
      placeholderStyle: "fancy",
      categories: { emails: false, bogus: true, phones: "no" }
    }));
    expect(merged.enabled).toBe(true);
    expect(merged.placeholderStyle).toBe("typed");
    expect(merged.categories.emails).toBe(false);
    expect(merged.categories.phones).toBe(true);
    expect("bogus" in merged.categories).toBe(false);
  });
});
