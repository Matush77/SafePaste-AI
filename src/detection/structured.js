// Personal data identified by its field name in JSON, YAML, "Label: value"
// lines, and CSV/TSV/Markdown tables.

import { Collector, isPlaceholder } from "./util.js";

/** @typedef {import("../redactor.js").Category} Category */

/** @type {[RegExp, string, Category][]} */
const FIELDS = [
  [/^(?:full_?name|first_?name|last_?name|surname|given_?name|family_?name|middle_?name|contact_?name|customer_?name|client_?name|patient_?name|employee_?name|person|passenger|traveler|traveller|payee|beneficiary|account_?holder|card_?holder|cardholder|signer|name)$/, "PERSON", "people"],
  [/^(?:phone|phone_?number|phone_?no|tel|telephone|mobile|mobile_?number|cell|cell_?phone|fax|contact_?number|whatsapp)$/, "PHONE", "phones"],
  [/^(?:address|street|street_?address|address_?line_?\d?|addr|home_?address|shipping_?address|billing_?address|mailing_?address|residence|zip|zip_?code|post_?code|postal_?code|plz|psc)$/, "ADDRESS", "addresses"],
  [/^(?:city|town|locality|place_?of_?birth|hometown|home_?town|birthplace)$/, "LOCATION", "locations"],
  [/^(?:dob|date_?of_?birth|birth_?date|birthday|ssn|social_?security(?:_?number)?|national_?id|passport(?:_?number|_?no)?|tax_?id|tin|nino|ni_?number|driver_?licen[cs]e(?:_?number)?|id_?number|personal_?id)$/, "ID", "governmentIds"],
  [/^(?:iban|account_?number|acct_?number|bank_?account|card_?number|credit_?card|cc_?number|routing_?number|sort_?code)$/, "FINANCIAL", "financial"]
];

// "key": "value", 'key': 'value', key: value, key = value (one line).
const KEY_VALUE = /(?<![\w-])["']?([A-Za-z][\w -]{0,30}?)["']?[ \t]*[:=][ \t]*(?:"([^"\n]{1,120})"|'([^'\n]{1,120})'|([^\s"'{[][^\n,;{}[\]]{0,119}))/dg;
const TYPE_WORDS = /^(?:string|str|text|number|int|integer|float|bool|boolean|date|datetime|email|phone|null|none|nil|undefined|true|false|required|optional|object|array|any|varchar(?:\(\d+\))?|char)$/i;

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectStructured(text) {
  const out = new Collector(text);

  for (const match of text.matchAll(KEY_VALUE)) {
    const field = fieldFor(match[1]);
    if (!field) {
      continue;
    }
    const group = match[2] !== undefined ? 2 : match[3] !== undefined ? 3 : 4;
    const value = match[group].replace(/\s+$/, "");
    if (isValueFor(field[2], value)) {
      out.addGroup(match, group, field[1], field[2], "high");
    }
  }

  collectTables(text, out);
  return out.items;
}

/** @param {string} key */
function fieldFor(key) {
  const normalised = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s.-]+/g, "_");
  return FIELDS.find(([pattern]) => pattern.test(normalised)) || null;
}

/**
 * Whether a value plausibly holds data of that kind, so schemas, types and
 * package names are not redacted.
 * @param {Category} category
 * @param {string} value
 */
function isValueFor(category, value) {
  const v = value.trim();
  if (!v || isPlaceholder(v) || TYPE_WORDS.test(v) || v.length > 120) {
    return false;
  }
  switch (category) {
    case "people":
      // A real name: 1-5 words of letters, each capitalised.
      return /^\p{Lu}[\p{L}'’.-]*(?:\s+(?:\p{Lu}[\p{L}'’.-]*|de|del|da|di|van|von|der|la|le|al|bin))*$/u.test(v) && v.split(/\s+/).length <= 5;
    case "phones":
      return /^[+\d()][\d\s().-]{5,}$/.test(v) && v.replace(/\D/g, "").length >= 7;
    case "locations":
      return /^\p{Lu}[\p{L}'’. -]{1,40}$/u.test(v);
    case "addresses":
      // Street text, not a host:port or an IP address.
      return /\p{L}{2}/u.test(v) && (/\d/.test(v) || v.split(/\s+/).length >= 2);
    default:
      return /\d/.test(v) || v.length >= 6;
  }
}

/**
 * CSV, TSV, semicolon-separated and Markdown tables with a header row.
 * @param {string} text
 * @param {Collector} out
 */
function collectTables(text, out) {
  const lines = text.split("\n");
  let offset = 0;
  /** @type {{ separator: string, columns: (ReturnType<typeof fieldFor>)[] } | null} */
  let table = null;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    if (!line.trim()) {
      table = null;
      continue;
    }

    if (table) {
      if (/^\s*\|?\s*:?-{3,}/.test(line)) {
        continue;
      }
      const cells = splitCells(line, table.separator);
      for (let i = 0; i < cells.length && i < table.columns.length; i += 1) {
        const field = table.columns[i];
        const cell = cells[i];
        if (field && isValueFor(field[2], cell.value)) {
          out.add(lineStart + cell.start, lineStart + cell.end, field[1], field[2], "high");
        }
      }
      continue;
    }

    const separator = ["\t", "|", ";", ","].find((sep) => line.split(sep).length >= 2);
    if (!separator) {
      continue;
    }
    const headers = splitCells(line, separator).map((cell) => cell.value.replace(/^["']|["']$/g, ""));
    // A header row is short labels, not a sentence that happens to contain commas.
    if (!headers.every((header) => /^[\p{L}\d _.#/-]{0,30}$/u.test(header) && header.split(/\s+/).length <= 3)) {
      continue;
    }
    const columns = headers.map(fieldFor);
    if (columns.some(Boolean)) {
      table = { separator, columns };
    }
  }
}

/**
 * @param {string} line
 * @param {string} separator
 * @returns {{ value: string, start: number, end: number }[]}
 */
function splitCells(line, separator) {
  const cells = [];
  let start = 0;
  const trimmedLine = separator === "|" ? line.replace(/^\s*\|/, (m) => " ".repeat(m.length)) : line;
  for (let i = 0; i <= trimmedLine.length; i += 1) {
    if (i === trimmedLine.length || trimmedLine[i] === separator) {
      const raw = trimmedLine.slice(start, i);
      const leading = raw.length - raw.trimStart().length;
      const value = raw.trim().replace(/^"(.*)"$/, "$1");
      const valueStart = start + leading + (raw.trim().startsWith("\"") ? 1 : 0);
      if (value) {
        cells.push({ value, start: valueStart, end: valueStart + value.length });
      } else {
        cells.push({ value: "", start: i, end: i });
      }
      start = i + 1;
    }
  }
  return cells;
}
