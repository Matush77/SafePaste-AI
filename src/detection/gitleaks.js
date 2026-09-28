// Secret detection with the gitleaks rule set (see data/gitleaksRules.js).
// Behaves like gitleaks: a rule runs only when one of its keywords occurs,
// the secret is the rule's capture group, and entropy thresholds, allowlists
// and stopwords filter out non-secrets. Rules are applied to windows around
// keyword occurrences, which bounds the work for patterns written for Go's
// linear-time engine that could backtrack in JavaScript.

import { GITLEAKS_GLOBAL_ALLOWLIST, GITLEAKS_RULES } from "./data/gitleaksRules.js";
import { Collector, entropy, lineAt } from "./util.js";

/**
 * @typedef {{ source: string, flags: string }} SerializedRegex
 * @typedef {{ target: "secret" | "match" | "line", regexes: SerializedRegex[], stopwords: string[] }} RuleAllowlist
 * @typedef {{ regexes: SerializedRegex[], stopwords: string[] }} GitleaksAllowlist
 * @typedef {{ id: string, regex: string, flags: string, keywords: string[], secretGroup: number | null, entropy: number | null, allowlists: RuleAllowlist[] }} GitleaksRule
 */

// Characters of context around a keyword that a rule is applied to.
const WINDOW_BEFORE = 200;
const WINDOW_AFTER = 600;
// Windows are widened to whole lines, up to this many extra characters, so
// that "$", "\b" and length limits are not satisfied by a cut in mid-token,
// which would redact only part of a secret.
const LINE_SNAP = 2000;
// Long windows are matched in overlapping chunks (see chunks()). Matches
// within EDGE_MARGIN of a cut are left to the neighbouring chunk, so a secret
// up to CHUNK_OVERLAP - 2 * EDGE_MARGIN characters long is always seen whole.
// Longer ones (private keys, huge JWTs) are handled by secrets.js.
const CHUNK = 5000;
const CHUNK_OVERLAP = 2000;
const EDGE_MARGIN = 64;

// gitleaks' catch-all rule: keyword + random-looking value. Useful, but less
// certain than provider-specific formats.
const GENERIC_RULES = new Set(["generic-api-key"]);

/** @type {Map<string, RegExp>} */
const compiled = new Map();
/** @param {SerializedRegex} regex */
function toRegExp(regex) {
  const key = `${regex.flags}/${regex.source}`;
  let result = compiled.get(key);
  if (!result) {
    result = new RegExp(regex.source, regex.flags);
    compiled.set(key, result);
  }
  return result;
}
const globalRegexes = GITLEAKS_GLOBAL_ALLOWLIST.regexes.map(toRegExp);

/**
 * @param {string} text
 * @param {GitleaksRule[]} [rules] All rules by default; tests time them one by one.
 * @returns {import("./util.js").Candidate[]}
 */
export function detectGitleaks(text, rules = GITLEAKS_RULES) {
  const out = new Collector(text);
  const lower = text.toLowerCase();
  const lines = new Lines(text);

  for (const rule of rules) {
    const windows = rule.keywords.length ? keywordWindows(lower, rule.keywords, lines) : [[0, text.length]];
    if (!windows.length) {
      continue;
    }
    const regex = toRegExp({ source: rule.regex, flags: `${rule.flags}dg` });
    /** @type {Set<number>} Secret starts already added (chunks overlap). */
    const seen = new Set();
    for (const [windowStart, windowEnd] of windows) {
      for (const [start, end] of chunks(windowStart, windowEnd)) {
        const slice = text.slice(start, end);
        // Near a cut between chunks, a match may depend on text the chunk
        // does not have; the neighbouring chunk sees that match whole.
        const low = start > windowStart ? EDGE_MARGIN : 0;
        const high = end < windowEnd ? slice.length - EDGE_MARGIN : slice.length;
        for (const match of slice.matchAll(regex)) {
          const matchStart = /** @type {number} */ (match.index);
          if (matchStart < low || matchStart + match[0].length > high) {
            continue;
          }
          const group = secretGroup(rule, match);
          const indices = /** @type {any} */ (match).indices[group];
          if (!indices) {
            continue;
          }
          const secret = match[group];
          const secretStart = start + indices[0];
          if (!secret || seen.has(secretStart) || (rule.entropy !== null && entropy(secret) < rule.entropy) || isAllowed(rule, secret, match[0], lineAt(text, secretStart))) {
            continue;
          }
          seen.add(secretStart);
          const generic = GENERIC_RULES.has(rule.id);
          out.add(secretStart, secretStart + secret.length, generic ? "SECRET" : typeFor(rule.id), generic ? "credentials" : "apiKeys", generic ? "medium" : "high");
        }
      }
    }
  }
  return out.items;
}

/**
 * Splits [start, end) into overlapping chunks of at most CHUNK characters.
 * Some rules ("curl ... -u user:pass") scan with ".*" from every keyword and
 * backtrack in JavaScript, so the work per chunk grows with its length
 * squared; chunking keeps the total linear in the text length.
 * @param {number} start
 * @param {number} end
 * @returns {[number, number][]}
 */
export function chunks(start, end) {
  /** @type {[number, number][]} */
  const result = [];
  for (let from = start; ; from += CHUNK - CHUNK_OVERLAP) {
    const to = Math.min(end, from + CHUNK);
    result.push([from, to]);
    if (to === end) {
      return result;
    }
  }
}

/**
 * Merged [start, end) windows around every keyword occurrence.
 * @param {string} lower
 * @param {string[]} keywords
 * @param {Lines} lines
 */
function keywordWindows(lower, keywords, lines) {
  /** @type {[number, number][]} */
  const windows = [];
  for (const keyword of keywords) {
    for (let index = lower.indexOf(keyword); index !== -1; index = lower.indexOf(keyword, index + keyword.length)) {
      windows.push([lines.snapStart(index - WINDOW_BEFORE), lines.snapEnd(index + keyword.length + WINDOW_AFTER)]);
    }
  }
  windows.sort((a, b) => a[0] - b[0]);
  /** @type {[number, number][]} */
  const merged = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window[0] <= last[1]) {
      last[1] = Math.max(last[1], window[1]);
    } else {
      merged.push([...window]);
    }
  }
  return merged;
}

/**
 * Line boundaries of a text, for widening windows to whole lines in
 * logarithmic time (searching for "\n" from every keyword would make long
 * single-line pastes quadratic).
 */
export class Lines {
  /** @param {string} text */
  constructor(text) {
    this.length = text.length;
    /** @type {number[]} Index of every "\n". */
    this.newlines = [];
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
      this.newlines.push(index);
    }
  }

  /**
   * Start of the line containing `index`, if it is at most LINE_SNAP back.
   * @param {number} index
   */
  snapStart(index) {
    if (index <= 0) {
      return 0;
    }
    // Last newline before index.
    const position = this.search(index) - 1;
    const lineStart = position < 0 ? 0 : this.newlines[position] + 1;
    return index - lineStart <= LINE_SNAP ? lineStart : index;
  }

  /**
   * End of the line containing `index`, if it is at most LINE_SNAP ahead.
   * @param {number} index
   */
  snapEnd(index) {
    if (index >= this.length) {
      return this.length;
    }
    // First newline at or after index.
    const position = this.search(index);
    const lineEnd = position < this.newlines.length ? this.newlines[position] : this.length;
    return lineEnd - index <= LINE_SNAP ? lineEnd : index;
  }

  /**
   * Number of newlines before `index`.
   * @param {number} index
   */
  search(index) {
    let low = 0;
    let high = this.newlines.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.newlines[middle] < index) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }
}

/**
 * gitleaks: the configured group, else the first non-empty group, else the
 * whole match.
 * @param {GitleaksRule} rule
 * @param {RegExpMatchArray} match
 */
function secretGroup(rule, match) {
  if (rule.secretGroup !== null) {
    return rule.secretGroup;
  }
  for (let group = 1; group < match.length; group += 1) {
    if (match[group]) {
      return group;
    }
  }
  return 0;
}

/**
 * @param {GitleaksRule} rule
 * @param {string} secret
 * @param {string} fullMatch
 * @param {string} line
 */
function isAllowed(rule, secret, fullMatch, line) {
  const lowerSecret = secret.toLowerCase();
  if (globalRegexes.some((regex) => regex.test(secret)) || GITLEAKS_GLOBAL_ALLOWLIST.stopwords.some((word) => lowerSecret.includes(word))) {
    return true;
  }
  for (const list of rule.allowlists) {
    const target = list.target === "match" ? fullMatch : list.target === "line" ? line : secret;
    if (list.regexes.some((regex) => toRegExp(regex).test(target)) || list.stopwords.some((word) => lowerSecret.includes(word))) {
      return true;
    }
  }
  return false;
}

/**
 * "github-pat" -> "GITHUB_PAT"
 * @param {string} id
 */
function typeFor(id) {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}
