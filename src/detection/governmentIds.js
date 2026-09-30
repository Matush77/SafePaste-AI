// National IDs, tax IDs, passports, licences, dates of birth, record numbers.

import { Collector, before } from "./util.js";

const MONTHS = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// "Our EIN is 12-3456789", "her date of birth was 3 March 1985".
const IS = String.raw`(?:\s+(?:is|was|are))?`;
const DATE =`(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}|\\d{1,2}\\.?\\s+${MONTHS}\\.?,?\\s+\\d{4}|${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})`;

/** @type {[string, RegExp, import("./util.js").Confidence][]} */
const LABELLED = [
  ["DOB", new RegExp(`\\b(?:DOB|D\\.O\\.B\\.?|date of birth|birth\\s?date|birthday|born(?: on)?|narozen[aý]?|narodený|narodená|né(?:e)? le|geboren(?: am)?|fecha de nacimiento|data di nascita)${IS}\\s*[:#(]?\\s*(${DATE})`, "dgi"), "high"],
  ["TAX_ID", new RegExp(String.raw`\b(?:EIN|TIN|ITIN|tax\s?(?:id|payer id|identification number|number|no\.?)|employer identification number|NIP|DIČ|IČO|IČ DPH|VAT(?:\s+(?:id|number|no\.?))?|USt-?IdNr\.?|UTR|SIREN|SIRET|codice fiscale|NIF|CIF)(?:\/tax id)?(?:\s+number)?${IS}\s*[:#]?\s*((?:[A-Z]{2})?\d[\d -]{6,16}\d|[A-Z0-9]{8,16})\b`, "dgi"), "high"],
  ["PASSPORT", new RegExp(String.raw`\bpassport(?:\s+(?:number|no\.?|#))?${IS}\s*[:#]?\s*([A-Z0-9]{6,9})\b`, "dgi"), "high"],
  ["DRIVER_LICENSE", new RegExp(String.raw`\b(?:driver'?s?\s+licen[cs]e|driving\s+licen[cs]e|DL|licen[cs]e\s+(?:number|no\.?))(?:\s+(?:number|no\.?|#))?${IS}\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,16})\b`, "dgi"), "high"],
  ["NATIONAL_ID", new RegExp(String.raw`\b(?:national id(?:entity)?(?: number)?|id card(?: number)?|identity card(?: number)?|číslo OP|OP|občiansky preukaz|občanský průkaz|DNI|NIE|personalausweis(?:nummer)?|carte d'identité|CNP|PESEL|BSN|personnummer|henkilötunnus|rodné číslo|RČ|birth number)${IS}\s*[:#]?\s*([A-Z]{0,3}\d[\dA-Z/ -]{4,14}[\dA-Z])\b`, "dgi"), "high"],
  ["RECORD_ID", /\b(?:MRN|medical record(?: number)?|patient (?:id|number|no\.?)|member (?:id|number)|insurance (?:id|number)|employee(?: (?:id|number|no\.?|#))?|EID|staff (?:id|number)|personnel number|badge (?:id|number)|student (?:id|number))\s*(?:is|:|#|no\.?)?\s*([A-Z]{0,3}-?\d[A-Z0-9-]{2,14})\b/dgi, "medium"],
  ["LICENSE_PLATE", /\b(?:licen[cs]e plate|number plate|vehicle plate|plate(?: number)?|registration(?: number| no\.?)|reg\.? no\.?|SPZ|ŠPZ|EČV|Kennzeichen|immatriculation|matrícula|targa)\s*[:#]?\s*([A-Z0-9]{1,4}[ -]?[A-Z0-9]{2,5})\b/dgi, "medium"],
  ["SSN", /\b(?:SSN|SSNs|social security(?: number)?|social insurance(?: number)?|SIN)\b[^\n\d]{0,20}(\d{9})\b/dgi, "high"]
];

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectGovernmentIds(text) {
  const out = new Collector(text);

  // US SSN written with separators; area/group/serial ranges must be possible.
  for (const match of text.matchAll(/(?<![\d-])(\d{3})([- ])(\d{2})\2(\d{4})(?![\d-])/g)) {
    if (validSsn(match[1], match[3], match[4])) {
      const index = /** @type {number} */ (match.index);
      out.add(index, index + match[0].length, "SSN", "governmentIds");
    }
  }
  // Unseparated SSNs listed under an "SSN" heading.
  for (const match of text.matchAll(/(?<!\d)(\d{3})(\d{2})(\d{4})(?!\d)/g)) {
    const index = /** @type {number} */ (match.index);
    if (validSsn(match[1], match[2], match[3]) && /\bssns?\b|social security/.test(before(text, index, 150))) {
      out.add(index, index + 9, "SSN", "governmentIds", "medium");
    }
  }

  // US EIN without a label: medium when tax words are nearby, otherwise only
  // in strict mode (the format also fits ratios and product codes).
  for (const match of text.matchAll(/(?<![\d-])\d{2}-\d{7}(?![\d-])/g)) {
    const index = /** @type {number} */ (match.index);
    const taxContext = /tax|\bein\b|\btin\b|employer|vendor|irs|w-?9|1099|identifier/.test(before(text, index, 80));
    out.add(index, index + match[0].length, "TAX_ID", "governmentIds", taxContext ? "medium" : "low");
  }

  // UK National Insurance number.
  for (const match of text.matchAll(/\b(?![DFIQUV])[A-CEGHJ-PR-TW-Z](?![DFIOQUV])[A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g)) {
    const index = /** @type {number} */ (match.index);
    if (!/^(?:BG|GB|KN|NK|NT|TN|ZZ)/.test(match[0])) {
      out.add(index, index + match[0].length, "NATIONAL_ID", "governmentIds");
    }
  }
  // "QQ" is the official example prefix, used in documentation and tests.
  for (const match of text.matchAll(/\bQQ ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g)) {
    const index = /** @type {number} */ (match.index);
    if (/insurance|\bni\b|nino/.test(before(text, index, 60))) {
      out.add(index, index + match[0].length, "NATIONAL_ID", "governmentIds", "medium");
    }
  }

  // UK NHS number: 10 digits, mod-11 check digit.
  for (const match of text.matchAll(/(?<!\d)(\d{3})[ -]?(\d{3})[ -]?(\d{4})(?!\d)/g)) {
    const index = /** @type {number} */ (match.index);
    if (validNhs(match[1] + match[2] + match[3]) && /\bnhs\b/.test(before(text, index, 40))) {
      out.add(index, index + match[0].length, "NATIONAL_ID", "governmentIds");
    }
  }

  // Czech/Slovak birth number (rodné číslo): YYMMDD/SSS(C).
  for (const match of text.matchAll(/(?<![\d/])(\d{2})(\d{2})(\d{2})\/(\d{3,4})(?![\d/])/g)) {
    if (validBirthNumber(match)) {
      const index = /** @type {number} */ (match.index);
      out.add(index, index + match[0].length, "NATIONAL_ID", "governmentIds");
    }
  }

  // Record numbers whose prefix says what they are: medical record, employee,
  // patient and member numbers.
  for (const match of text.matchAll(/\b(?:MRN|EMP|PAT|MBR)[-#]?\d{5,10}\b/g)) {
    const index = /** @type {number} */ (match.index);
    out.add(index, index + match[0].length, "RECORD_ID", "governmentIds", "medium");
  }

  for (const [type, regex, confidence] of LABELLED) {
    for (const match of text.matchAll(regex)) {
      const value = match[1];
      if (type !== "DOB" && !/\d/.test(value)) {
        continue;
      }
      // Plates are written in capitals; "plate 3 eggs" is a recipe.
      if (type === "LICENSE_PLATE" && /[a-z]/.test(value)) {
        continue;
      }
      out.addGroup(match, 1, type, "governmentIds", confidence);
    }
  }

  return out.items;
}

/**
 * @param {string} area
 * @param {string} group
 * @param {string} serial
 */
function validSsn(area, group, serial) {
  const a = Number(area);
  return a !== 0 && a !== 666 && a < 900 && group !== "00" && serial !== "0000";
}

/** @param {string} digits */
function validNhs(digits) {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(digits[i]) * (10 - i);
  }
  const check = 11 - (sum % 11);
  return (check === 11 ? 0 : check) === Number(digits[9]) && check !== 10;
}

/** @param {RegExpMatchArray} match */
function validBirthNumber(match) {
  let month = Number(match[2]);
  const day = Number(match[3]);
  if (month > 70) {
    month -= 70;
  } else if (month > 50) {
    month -= 50;
  } else if (month > 20) {
    month -= 20;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  if (match[4].length === 3) {
    return true;
  }
  const number = Number(match[1] + match[2] + match[3] + match[4]);
  const firstNine = Math.floor(number / 10);
  const check = (firstNine % 11) % 10;
  return number % 11 === 0 || check === number % 10;
}
