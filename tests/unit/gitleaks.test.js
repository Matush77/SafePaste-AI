// The gitleaks rule set: conversion of its Go regexes to JavaScript, and the
// runtime that applies them (keyword windows, chunks, entropy, allowlists).
// Token fixtures are assembled from pieces so secret scanners do not flag
// this file.
import { describe, expect, it } from "vitest";
import { convertRegex } from "../../scripts/goRegex.js";
import { GITLEAKS_GLOBAL_ALLOWLIST, GITLEAKS_RULES } from "../../src/detection/data/gitleaksRules.js";
import { Lines, chunks, detectGitleaks } from "../../src/detection/gitleaks.js";

const GITHUB_PAT = "ghp" + "_" + "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa";

/** @param {string} text */
function found(text) {
  return detectGitleaks(text).map((match) => ({ value: text.slice(match.start, match.end), type: match.type, category: match.category, confidence: match.confidence }));
}

describe("Go to JavaScript regex conversion", () => {
  it("turns a leading (?i) into the i flag", () => {
    expect(convertRegex("(?i)abc")).toEqual({ source: "abc", flags: "i" });
  });

  it("expands (?i) in the middle of a pattern into case classes", () => {
    const { source, flags } = convertRegex("x(?i)ab");
    expect(flags).toBe("");
    expect(source).toBe("x[aA][bB]");
    expect(new RegExp(source).test("xAb")).toBe(true);
    expect(new RegExp(source).test("XAb")).toBe(false);
  });

  it("scopes (?i:...) and (?-i:...) to their group", () => {
    const { source } = convertRegex("(?i:ab)c(?-i:d)");
    const regex = new RegExp(`^${source}$`);
    expect(regex.test("ABcd")).toBe(true);
    expect(regex.test("abCd")).toBe(false);
  });

  it("keeps a leading (?i) inline when the pattern also turns it off", () => {
    const { source, flags } = convertRegex("(?i)a(?-i:b)");
    expect(flags).toBe("");
    const regex = new RegExp(`^${source}$`);
    expect(regex.test("Ab")).toBe(true);
    expect(regex.test("AB")).toBe(false);
  });

  it("case-folds letters and ranges inside classes under (?i)", () => {
    const { source } = convertRegex("x(?i)[a-c_]");
    expect(source).toBe("x[a-c_A-C]");
  });

  it("leaves escapes and classes alone outside (?i)", () => {
    expect(convertRegex("\\bA[x-z]\\d").source).toBe("\\bA[x-z]\\d");
  });

  it("renames (?P<name> groups and converts \\A, \\z and (?s:.)", () => {
    const { source } = convertRegex("\\A(?P<key>a(?s:.)b)\\z");
    expect(source).toBe("^(?<key>a[\\s\\S]b)$");
    expect(new RegExp(source).exec("a\nb")?.groups?.key).toBe("a\nb");
  });

  it("expands POSIX classes, alone and inside other classes", () => {
    expect(convertRegex("pat[[:alnum:]]{3}").source).toBe("pat[0-9A-Za-z]{3}");
    const { source } = convertRegex("^[[:xdigit:]_-]+$");
    expect(new RegExp(source).test("aF09_-")).toBe(true);
    expect(new RegExp(source).test("g")).toBe(false);
  });

  it("does not mistake an escaped bracket for a POSIX class", () => {
    const { source } = convertRegex("[\\[:a:\\]]");
    expect(new RegExp(source).test("[")).toBe(true);
  });

  it("rejects what JavaScript cannot express", () => {
    expect(() => convertRegex("[[:^alpha:]]")).toThrow(/unsupported POSIX class/);
    expect(() => convertRegex("[abc")).toThrow(/unterminated/);
  });
});

describe("generated rule set", () => {
  it("has the gitleaks rules, each compiling as used at runtime", () => {
    expect(GITLEAKS_RULES.length).toBeGreaterThan(200);
    for (const rule of GITLEAKS_RULES) {
      expect(() => new RegExp(rule.regex, `${rule.flags}dg`), rule.id).not.toThrow();
      for (const list of rule.allowlists) {
        for (const regex of list.regexes) {
          expect(() => new RegExp(regex.source, regex.flags), rule.id).not.toThrow();
        }
      }
    }
    for (const regex of GITLEAKS_GLOBAL_ALLOWLIST.regexes) {
      expect(() => new RegExp(regex.source, regex.flags)).not.toThrow();
    }
  });

  it("has unique ids and lower-case keywords", () => {
    expect(new Set(GITLEAKS_RULES.map((rule) => rule.id)).size).toBe(GITLEAKS_RULES.length);
    for (const rule of GITLEAKS_RULES) {
      for (const keyword of rule.keywords) {
        expect(keyword, rule.id).toBe(keyword.toLowerCase());
      }
    }
  });

  it("contains no RE2-only syntax", () => {
    for (const rule of GITLEAKS_RULES) {
      expect(rule.regex, rule.id).not.toMatch(/\(\?P<|\(\?-?[a-z]+[:)]|\[:\^?[a-z]+:\]|\\[zAQE]/);
    }
  });
});

describe("gitleaks detection", () => {
  it("finds provider tokens as high-confidence API keys", () => {
    expect(found(`token ${GITHUB_PAT}`)).toEqual([{ value: GITHUB_PAT, type: "GITHUB_PAT", category: "apiKeys", confidence: "high" }]);
  });

  it("finds the value of a secret-looking assignment at medium confidence", () => {
    expect(found('client_secret: "q8Zt4Lm2Vx9Rk3Np7Wc"')).toEqual([{ value: "q8Zt4Lm2Vx9Rk3Np7Wc", type: "SECRET", category: "credentials", confidence: "medium" }]);
  });

  it("finds credentials in curl commands", () => {
    expect(found("curl -u admin:S3cr3tPass9 https://api.example.com/v1").map((match) => match.value)).toEqual(["admin:S3cr3tPass9"]);
    expect(found('curl https://api.example.com -H "Authorization: Bearer q8Zt4Lm2Vx9Rk3Np7Wc"').map((match) => match.value)).toContain("q8Zt4Lm2Vx9Rk3Np7Wc");
  });

  it("matches rules that used a POSIX class in Go", () => {
    const token = "pat" + "Ab3dE5gH7jK9mN" + "." + "0123456789abcdef".repeat(4);
    expect(found(`my airtable token: ${token}`).map((match) => match.type)).toContain("AIRTABLE_PERSONNAL_ACCESS_TOKEN");
  });

  it("applies allowlists, stopwords and entropy thresholds", () => {
    expect(found('api_key = ${API_KEY}\npassword: "xxxxxxxxxxxx"\ntoken = your_token_here')).toEqual([]);
    expect(found("AWS key AKIA" + "IOSFODNN7EXAMPLE")).toEqual([]);
  });

  it("runs a rule only where one of its keywords occurs", () => {
    expect(found("ref q8Zt4Lm2Vx9Rk3Np7Wc")).toEqual([]);
  });

  it("finds a token whole wherever it falls on a long line of keywords", () => {
    // Keywords everywhere merge into one long window that is matched in
    // overlapping chunks; a token across a chunk cut must not be split.
    const filler = "ghp_ ".repeat(3000);
    for (let offset = 2900; offset < 5200; offset += 37) {
      const text = `${filler.slice(0, offset)} ${GITHUB_PAT} ${filler.slice(offset)}`;
      const values = found(text).map((match) => match.value);
      expect(values, `offset ${offset}`).toEqual([GITHUB_PAT]);
    }
  });
});

describe("gitleaks windows", () => {
  it("covers a range with overlapping chunks", () => {
    expect(chunks(0, 100)).toEqual([[0, 100]]);
    const parts = chunks(10, 12000);
    expect(parts[0][0]).toBe(10);
    expect(parts[parts.length - 1][1]).toBe(12000);
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i][0]).toBeLessThan(parts[i - 1][1]);
    }
  });

  it("widens windows to line boundaries nearby, not far away", () => {
    const text = "line one\nline two\n" + "x".repeat(5000);
    const lines = new Lines(text);
    expect(lines.snapStart(12)).toBe(9);
    expect(lines.snapEnd(12)).toBe(17);
    expect(lines.snapStart(3)).toBe(0);
    // The last line is 5000 characters: too far to widen to from its middle.
    expect(lines.snapEnd(20)).toBe(20);
    expect(lines.snapEnd(text.length - 100)).toBe(text.length);
    expect(lines.snapStart(text.length - 10)).toBe(text.length - 10);
    expect(lines.snapStart(1000)).toBe(18);
  });
});
