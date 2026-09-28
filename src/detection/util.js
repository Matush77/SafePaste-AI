// Shared helpers for the detection rules.

/**
 * @typedef {import("../redactor.js").Category} Category
 * @typedef {"high" | "medium" | "low"} Confidence
 *
 * @typedef {object} Candidate
 * @property {number} start
 * @property {number} end
 * @property {string} type   Placeholder label, e.g. "EMAIL".
 * @property {Category} category
 * @property {Confidence} confidence
 * @property {boolean} [contextual] Only personal data when near other personal
 *   data (place names, institutions); promoted from "low" in that case.
 */

/**
 * Collects candidates for one rule module.
 */
export class Collector {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    /** @type {Candidate[]} */
    this.items = [];
  }

  /**
   * @param {number} start
   * @param {number} end
   * @param {string} type
   * @param {Category} category
   * @param {Confidence} [confidence]
   * @param {boolean} [contextual]
   */
  add(start, end, type, category, confidence = "high", contextual = false) {
    // Never redact surrounding whitespace or wrapping quotes.
    while (start < end && /[\s"'`]/.test(this.text[start])) {
      start += 1;
    }
    while (end > start && /[\s"'`]/.test(this.text[end - 1])) {
      end -= 1;
    }
    if (end > start) {
      this.items.push(contextual ? { start, end, type, category, confidence, contextual } : { start, end, type, category, confidence });
    }
  }

  /**
   * Adds capture group `group` of a regex match (the regex needs the `d` flag).
   * @param {RegExpMatchArray} match
   * @param {number} group
   * @param {string} type
   * @param {Category} category
   * @param {Confidence} [confidence]
   */
  addGroup(match, group, type, category, confidence = "high") {
    const indices = /** @type {any} */ (match).indices;
    const range = indices && indices[group];
    if (range) {
      this.add(range[0], range[1], type, category, confidence);
    }
  }
}

/**
 * Lower-cased text just before `index`, for context checks.
 * @param {string} text
 * @param {number} index
 * @param {number} length
 */
export function before(text, index, length) {
  return text.slice(Math.max(0, index - length), index).toLowerCase();
}

/**
 * Lower-cased text just after `index`.
 * @param {string} text
 * @param {number} index
 * @param {number} length
 */
export function after(text, index, length) {
  return text.slice(index, index + length).toLowerCase();
}

/**
 * The full line containing `index`.
 * @param {string} text
 * @param {number} index
 */
export function lineAt(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

/** @param {string} digits */
export function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/**
 * Shannon entropy in bits per character.
 * @param {string} value
 */
export function entropy(value) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const char of value) {
    counts.set(char, (counts.get(char) || 0) + 1);
  }
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Whether a string looks like a random secret rather than a word or identifier.
 * @param {string} value
 */
export function looksRandom(value) {
  if (value.length < 12) {
    return false;
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  return classes >= 2 && entropy(value) >= 3.3;
}

/**
 * Values that stand in for a secret in docs and templates rather than being one.
 * @param {string} value
 */
export function isPlaceholder(value) {
  const v = value.trim();
  return (
    v.length === 0 ||
    /^(<[^>]*>|\[[^\]]*\]|\{\{.*\}\}|\$\{.*\}|%\w+%|\*+|\.{3,}|…)$/.test(v) ||
    /x{4,}|X{4,}|\*{3,}/.test(v) ||
    /^(your|my|insert|enter|replace|put|add)[\s_-]/i.test(v) ||
    /[_-](here|goes[_-]here)$/i.test(v) ||
    /^(change[\s_-]?me|replace[\s_-]?me|changeit|placeholder|redacted|example|sample|dummy|test|todo|tbd|none|null|nil|undefined|empty|required|optional|secret|password|passwd|token|string|hidden)$/i.test(v)
  );
}

/**
 * Common mod-97 check used by IBANs.
 * @param {string} value  Letters and digits only.
 */
export function mod97(value) {
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char >= "A" && char <= "Z" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of code) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Uppercase letter, including accented ones. */
export const UPPER = "\\p{Lu}";
/** Any letter. */
export const LETTER = "\\p{L}";
/** A capitalised word such as "Kováčik", "O'Brien" or "Al-Sayed". */
export const CAP_WORD = `\\p{Lu}[\\p{Ll}\\p{Lm}'’]*(?:[-'’]\\p{Lu}?[\\p{Ll}]+)*`;
