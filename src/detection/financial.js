// Payment cards, IBANs, bank account details, crypto wallets.

import { Collector, before, luhnValid, mod97 } from "./util.js";

// IBAN length per country (ISO 13616 registry).
const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18,
  GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24,
  PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20
};

const CARD_CANDIDATE = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;
const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/g;

/** @type {[string, RegExp, import("./util.js").Confidence][]} */
const LABELLED = [
  ["BANK_ACCOUNT", /\b(?:account|acct|a\/c|konto|účet|účtu|kontonummer|compte|cuenta|conto)(?:\s+(?:number|no\.?|nr\.?|#|číslo))?\s*[:#]?\s*(\d[\d -]{5,22}\d(?:\/\d{4})?)\b/dgi, "high"],
  ["ROUTING_NUMBER", /\b(?:routing(?:\s+number)?|ABA(?:\s+number)?|RTN|transit(?:\s+number)?)\s*(?:\([^)]*\))?\s*[:#]?\s*(\d{9})\b/dgi, "high"],
  ["SORT_CODE", /\bsort\s*code\s*[:#]?\s*(\d{2}[- ]\d{2}[- ]\d{2})\b/dgi, "high"],
  ["SWIFT_BIC", /\b(?:SWIFT|BIC)(?:\s*(?:code|\/BIC))?\s*[:#]?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/dg, "high"],
  ["CARD_CVV", /\b(?:cvv2?|cvc2?|cid|security\s+code)\s*[:#]?\s*(\d{3,4})\b/dgi, "high"],
  ["CARD_EXPIRY", /\b(?:exp(?:iry|ires|iration)?(?:\s+date)?)\s*[:#]?\s*((?:0[1-9]|1[0-2])\s?\/\s?(?:\d{2}|\d{4}))\b/dgi, "medium"],
  ["POLICY_NUMBER", /\bpolicy(?:\s+(?:number|no\.?|#))?\s*[:#]?\s*([A-Z]{0,4}-?\d[A-Z0-9-]{5,20})\b/dg, "medium"]
];

const CRYPTO = [
  /\bbc1[ac-hj-np-z02-9]{25,62}\b/g,
  /\b0x[a-fA-F0-9]{40}\b/g
];
const CRYPTO_LEGACY = /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g;

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectFinancial(text) {
  const out = new Collector(text);

  for (const match of text.matchAll(CARD_CANDIDATE)) {
    const digits = match[0].replace(/\D/g, "");
    const separators = new Set(match[0].replace(/\d/g, ""));
    if (separators.size <= 1 && isCardNumber(digits)) {
      const index = /** @type {number} */ (match.index);
      out.add(index, index + match[0].length, "CREDIT_CARD", "financial");
    }
  }

  for (const match of text.matchAll(IBAN_CANDIDATE)) {
    let value = match[0];
    const compact = value.replace(/[ -]/g, "");
    const expected = /** @type {Record<string, number>} */ (IBAN_LENGTHS)[compact.slice(0, 2)];
    if (!expected || compact.length < expected) {
      continue;
    }
    // The candidate may run into following words; keep only the IBAN itself.
    let kept = 0;
    let cut = 0;
    for (; cut < value.length && kept < expected; cut += 1) {
      if (/[A-Z0-9]/.test(value[cut])) {
        kept += 1;
      }
    }
    value = value.slice(0, cut);
    if (mod97(compact.slice(0, expected))) {
      const index = /** @type {number} */ (match.index);
      out.add(index, index + value.length, "IBAN", "financial");
    }
  }

  for (const [type, regex, confidence] of LABELLED) {
    for (const match of text.matchAll(regex)) {
      out.addGroup(match, 1, type, "financial", confidence);
    }
  }

  for (const regex of CRYPTO) {
    for (const match of text.matchAll(regex)) {
      const index = /** @type {number} */ (match.index);
      const walletContext = /wallet|address|btc|bitcoin|eth|ethereum|send|pay|crypto/.test(before(text, index, 60));
      if (match[0].startsWith("bc1") || walletContext) {
        out.add(index, index + match[0].length, "CRYPTO_WALLET", "financial", "high");
      }
    }
  }
  for (const match of text.matchAll(CRYPTO_LEGACY)) {
    const index = /** @type {number} */ (match.index);
    if (/wallet|btc|bitcoin|crypto/.test(before(text, index, 60))) {
      out.add(index, index + match[0].length, "CRYPTO_WALLET", "financial", "medium");
    }
  }

  return out.items;
}

/**
 * Luhn plus a real issuer prefix and length, so random 13-19 digit numbers
 * (timestamps, order IDs) are not mistaken for cards.
 * @param {string} digits
 */
function isCardNumber(digits) {
  const length = digits.length;
  if (!luhnValid(digits)) {
    return false;
  }
  const two = Number(digits.slice(0, 2));
  const four = Number(digits.slice(0, 4));
  const six = Number(digits.slice(0, 6));
  return (
    (digits[0] === "4" && [13, 16, 19].includes(length)) ||
    (((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) && length === 16) ||
    ((two === 34 || two === 37) && length === 15) ||
    ((four === 6011 || two === 65 || (six >= 644000 && six <= 649999) || (six >= 622126 && six <= 622925)) && length >= 16) ||
    (four >= 3528 && four <= 3589 && length >= 16) ||
    ((two === 36 || two === 38 || (six >= 300000 && six <= 305999)) && length >= 14) ||
    (two === 62 && length >= 16) ||
    ((four === 5018 || four === 5020 || four === 5038 || four === 6304 || four === 6759 || four === 6761 || four === 6763) && length >= 12)
  );
}
