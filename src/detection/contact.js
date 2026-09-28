// Email addresses and phone numbers.

import { Collector, before } from "./util.js";

const EMAIL = /(?<![\p{L}\p{N}._%+'-])[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}-])/gu;
// "sarah dot kim at protonmail dot com", "jane [at] example [dot] com"
const DOT = String.raw`(?:\s*\[dot\]\s*|\s*\(dot\)\s*|\s+dot\s+)`;
const AT = String.raw`(?:\s*\[at\]\s*|\s*\(at\)\s*|\s+at\s+)`;
const TLD = "(?:com|org|net|edu|gov|io|co|ai|app|dev|me|info|biz|eu|uk|de|fr|es|it|nl|be|at|ch|pl|cz|sk|hu|se|no|dk|fi|ie|pt|ru|ua|us|ca|au|nz|in|jp|cn|br|mx)";
const OBFUSCATED_EMAIL = new RegExp(String.raw`(?<![\p{L}\p{N}])[\p{L}\p{N}_-]{1,40}(?:${DOT}[\p{L}\p{N}_-]{1,40}){0,4}${AT}[\p{L}\p{N}_-]{1,40}(?:${DOT}[\p{L}\p{N}_-]{1,40}){0,3}${DOT}${TLD}(?![\p{L}\p{N}])`, "giu");

// A run of digits with phone-style separators. Validated below.
// Groups after the first must be separated (or parenthesised), so a digit run
// can only be split one way and long inputs cannot backtrack badly.
const PHONE_CANDIDATE = /(?<![\w+\-/.:#])(?:\+|00)?\(?\d{1,15}\)?(?:[ \t.\-\u00a0]{1,2}\(?\d{1,8}\)?|\(\d{1,5}\)){0,7}(?![\w\-/]|\.\d|:\d)/g;
const EXTENSION = /^\s*(?:ext\.?|extension|x|#)\s*\d{1,6}\b/i;
const EMBEDDED_PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]\d{4}$/;
// Toll-free vanity numbers: 1-800-FLOWERS, 877-PHONE-10.
const VANITY_PHONE = /(?<![\w-])(?:1[\s.-])?8(?:00|33|44|55|66|77|88)[\s.-](?=[A-Z0-9-]*[A-Z])[A-Z0-9]{2,7}(?:[\s.-][A-Z0-9]{1,4})?(?![\w-])/g;

const PHONE_CONTEXT = /(?:phone|tel\b|tel\.|telephone|mobile|mobil|cell|call|fax|whats ?app|sms|text me|reach me|contact|number is|numéro|nummer|číslo|telefon|téléphone|telefono|móvil|handy|direct line|hotline)[^\n\d]{0,25}$/;
const NOT_PHONE_CONTEXT = /\b(?:order|invoice|inv|ticket|case|claim|sku|part|item|serial|model|version|build|ref(?:erence)?|id|isbn|tracking|account|acct|policy|po|zip|postcode|routing|iban|swift|pin|otp|timestamp|epoch|port|pid|uid|gid|#)[\s:#.no-]{0,6}$/;

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectContact(text) {
  const out = new Collector(text);

  for (const match of text.matchAll(EMAIL)) {
    const index = /** @type {number} */ (match.index);
    out.add(index, index + match[0].length, "EMAIL", "emails");
  }
  for (const match of text.matchAll(OBFUSCATED_EMAIL)) {
    const index = /** @type {number} */ (match.index);
    out.add(index, index + match[0].length, "EMAIL", "emails", "medium");
  }

  collectPhones(text, out);
  for (const match of text.matchAll(VANITY_PHONE)) {
    const index = /** @type {number} */ (match.index);
    out.add(index, index + match[0].length, "PHONE", "phones", "medium");
  }
  return out.items;
}

/**
 * @param {string} text
 * @param {Collector} out
 */
function collectPhones(text, out) {
  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    let value = match[0].replace(/[\s.\-(]+$/, "");
    const start = /** @type {number} */ (match.index);
    if (value.startsWith("(") === false && value.endsWith(")") && !value.includes("(")) {
      value = value.slice(0, -1);
    }
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      continue;
    }

    const context = before(text, start, 40);
    if (NOT_PHONE_CONTEXT.test(context)) {
      continue;
    }
    const confidence = classifyPhone(value, digits, PHONE_CONTEXT.test(context));
    if (!confidence) {
      // "Suite 710 (409) 880-7011": the phone number is inside a longer digit run.
      const inner = EMBEDDED_PHONE.exec(value);
      if (inner && inner.index > 0) {
        const innerStart = start + inner.index;
        out.add(innerStart, innerStart + inner[0].length, "PHONE", "phones", "high");
      }
      continue;
    }

    let end = start + value.length;
    const extension = EXTENSION.exec(text.slice(end, end + 20));
    if (extension) {
      end += extension[0].length;
    }
    out.add(start, end, "PHONE", "phones", confidence);
  }
}

/**
 * @param {string} value  The candidate as written.
 * @param {string} digits Its digits only.
 * @param {boolean} hasContext A phone keyword precedes it.
 * @returns {import("./util.js").Confidence | null}
 */
function classifyPhone(value, digits, hasContext) {
  const separated = /[\s.\-()]/.test(value);
  const groups = value.split(/[\s.\-()]+/).filter(Boolean);

  // Dates and times are never phone numbers.
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(value)) {
    return null;
  }

  // International: +CC or 00CC followed by the number.
  if (/^(?:\+|00)/.test(value)) {
    return digits.length >= 8 ? "high" : null;
  }

  // North American: (415) 555-0199, 415-555-0199, 415.555.0199, 1-877-696-6775.
  if (/^(?:1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]\d{4}$/.test(value)) {
    return "high";
  }

  // National numbers with a trunk 0 written in groups: 0905 123 456,
  // 020 7946 0958, 01 42 68 53 00, 06 12 34 56 78.
  if (/^0\d/.test(value) && separated && groups.length >= 3 && groups.every((group) => group.length >= 2 && group.length <= 4)) {
    return hasContext ? "high" : "medium";
  }

  // Anything else only counts when the text says it is a phone number.
  if (hasContext && (separated || digits.length <= 12)) {
    return "medium";
  }
  return null;
}
