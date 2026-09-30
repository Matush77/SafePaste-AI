// Personal data identified by its field name:
// - code and config: "key": "value", key = value;
// - forms and documents: "Label: value", "**Label:** value", "- Label: value",
//   with several fields on one line;
// - tables: header rows over columns, and two-column "label | value" tables;
// - label phrases in running text: "account number C387265419",
//   "Employee IDs P9779023 and J-175274-E", "born on 1960-11-14".
// Field labels themselves ("Last Name", "Phone Number") are never values;
// isFieldLabel() lets the other detectors drop them too.

import { Collector, isPlaceholder } from "./util.js";

/**
 * @typedef {import("../redactor.js").Category} Category
 * @typedef {"name" | "phone" | "address" | "place" | "date" | "id" | "code" | "plate" | "digits" | "secret"} ValueKind
 * @typedef {{ type: string, category: Category, kind: ValueKind }} Field
 */

/** @type {[RegExp, Field][]} */
const FIELDS = [
  [/^(?:full_name|first_name|last_name|surname|given_name|family_name|middle_name|maiden_name|contact_name|customer_name|client_name|patient_name|employee_name|person|passenger|traveler|traveller|payee|beneficiary|beneficiary_name|account_holder|account_holder_name|card_holder|cardholder|cardholder_name|policyholder|policy_holder|insured|insured_name|signer|signatory|guarantor|next_of_kin|emergency_contact|name)$/, { type: "PERSON", category: "people", kind: "name" }],
  [/^(?:phone|phone_number|phone_no|tel|telephone|telephone_number|mobile|mobile_number|cell|cell_phone|cell_number|fax|fax_number|contact_number|whatsapp)$/, { type: "PHONE", category: "phones", kind: "phone" }],
  [/^(?:address|street|street_address|address_line_?\d?|addr|home_address|shipping_address|billing_address|mailing_address|residential_address|residence|property_address|zip|zip_code|post_code|postcode|postal_code|plz|psc)$/, { type: "ADDRESS", category: "addresses", kind: "address" }],
  [/^(?:city|town|locality|county|place_of_birth|hometown|home_town|birthplace)$/, { type: "LOCATION", category: "locations", kind: "place" }],
  [/^(?:dob|date_of_birth|birth_date|birthdate|birthday)$/, { type: "DOB", category: "governmentIds", kind: "date" }],
  [/^(?:ssn|social_security|social_security_number|social_insurance_number|sin|national_id|national_id_number|national_insurance_number|nino|ni_number|passport|passport_number|tax_id|tax_id_number|taxpayer_id|tin|itin|ein|driver_licen[cs]e|driver_licen[cs]e_number|drivers_licen[cs]e|drivers_licen[cs]e_number|driving_licen[cs]e|driving_licen[cs]e_number|id_number|personal_id|identity_number)$/, { type: "ID", category: "governmentIds", kind: "id" }],
  [/^(?:mrn|medical_record|medical_record_number|patient_id|patient_number|member_id|member_number|subscriber_id|subscriber_number|health_plan_number|health_plan_id|health_plan_beneficiary_number|health_plan_beneficiary_id|beneficiary_number|beneficiary_id|insurance_id|insurance_number|policy_number|employee_id|employee_number|staff_id|staff_number|badge_id|badge_number|student_id|student_number|licen[cs]e_number|certificate_number|certificate_licen[cs]e_number|professional_licen[cs]e|professional_licen[cs]e_number)$/, { type: "RECORD_ID", category: "governmentIds", kind: "id" }],
  [/^(?:licen[cs]e_plate|licen[cs]e_plate_number|plate_number|number_plate|vehicle_registration|registration_number|vin)$/, { type: "LICENSE_PLATE", category: "governmentIds", kind: "plate" }],
  [/^(?:account_number|acct_number|bank_account|bank_account_number|card_number|credit_card|credit_card_number|debit_card|debit_card_number|credit_debit_card|credit_debit_card_number|cc_number|routing_number|aba|aba_number|bank_routing_number|sort_code|cvv|cvc|security_code)$/, { type: "FINANCIAL", category: "financial", kind: "id" }],
  [/^(?:iban|swift|swift_bic|swift_code|bic|bic_code)$/, { type: "FINANCIAL", category: "financial", kind: "code" }],
  [/^(?:pin|pin_code|pin_number|account_pin|card_pin)$/, { type: "PIN", category: "credentials", kind: "digits" }],
  [/^(?:password|passwd|pwd|passcode|passphrase|temporary_password|temp_password|one_time_password|new_password|current_password)$/, { type: "PASSWORD", category: "credentials", kind: "secret" }]
];

// Common column and form labels that are not themselves sensitive fields.
// They are never values, and never names or organisations.
const OTHER_LABELS = new Set([
  "email", "email_address", "e_mail", "age", "gender", "sex", "occupation", "job_title", "title", "position", "role",
  "department", "employment_status", "status", "state", "country", "region", "province", "nationality", "date",
  "time", "value", "field", "details", "description", "notes", "note", "comments", "id", "type", "category",
  "company", "company_name", "organization", "organisation", "employer", "website", "url", "username", "user_name",
  "ip_address", "mac_address", "amount", "total", "quantity", "price", "currency", "product", "item",
  "service", "plan", "plan_name", "coverage", "provider", "customer_id", "order_id", "order_number", "invoice_number",
  "reference", "reference_number", "date_of_issue", "issue_date", "expiry_date", "expiration_date", "marital_status",
  "blood_type", "height", "weight", "language", "ethnicity", "religion", "education", "income", "salary", "signature"
]);

const TYPE_WORDS = /^(?:string|str|text|number|int|integer|float|bool|boolean|date|datetime|email|phone|null|none|nil|undefined|true|false|required|optional|object|array|any|varchar(?:\(\d+\))?|char)$/i;
const EMPTY_VALUE = /^(?:n\/?a|not (?:specified|applicable|provided|available|disclosed)|unknown|pending|tbd|tba|see (?:above|below)|[-–—]+|\.{2,})$/i;
const DATE_VALUE = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}\s+\p{L}{3,9}\.?,?\s+\d{4}|\p{L}{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})$/u;

// "key": "value", 'key': 'value', key = value (one line).
const KEY_VALUE = /(?<![\w-])["']?([A-Za-z][\w -]{0,30}?)["']?[ \t]*([:=])[ \t]*(?:"([^"\n]{1,120})"|'([^'\n]{1,120})'|([^\s"'{[][^\n,;{}[\]]{0,119}))/dg;

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectStructured(text) {
  const out = new Collector(text);

  for (const match of text.matchAll(KEY_VALUE)) {
    // Unquoted "Label: value" is read by collectLabelledFields, which knows
    // where values end in prose and Markdown.
    if (match[5] !== undefined && match[2] === ":") {
      continue;
    }
    const field = fieldFor(match[1]);
    // Passwords in code and config are secrets.js's job: it knows variable
    // references from values.
    if (!field || field.kind === "secret") {
      continue;
    }
    const group = match[3] !== undefined ? 3 : match[4] !== undefined ? 4 : 5;
    if (isValueFor(field, match[group])) {
      out.addGroup(match, group, field.type, field.category, "high");
    }
  }

  collectLabelledFields(text, out);
  collectTables(text, out);
  collectLabelPhrases(text, out);
  return out.items;
}

/**
 * "Medical Record Number (MRN)" -> "medical_record_number"
 * @param {string} key
 */
function normaliseKey(key) {
  return key
    .replace(/\([^()]{0,40}\)/g, " ")
    .replace(/[*_`]/g, " ")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/#/g, " number")
    .replace(/\bno\.?$/, "number")
    .replace(/'s\b/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_(id|number|record|plate)s$/, "_$1")
    .replace(/^(ssn|mrn|dob)s$/, "$1");
}

/**
 * The sensitive field a label names, if any. Longer labels match on their
 * last words ("Policyholder First Name"), but never on one generic word.
 * @param {string} key
 * @returns {Field | null}
 */
export function fieldFor(key) {
  const normalised = normaliseKey(key);
  if (!normalised || normalised.length > 60) {
    return null;
  }
  const words = normalised.split("_");
  for (let first = 0; first < words.length && (first === 0 || words.length - first >= 2); first += 1) {
    const candidate = words.slice(first).join("_");
    const found = FIELDS.find(([pattern]) => pattern.test(candidate));
    if (found) {
      return found[1];
    }
  }
  return null;
}

/**
 * Whether text is a form or column label ("Last Name", "Phone Number",
 * "Employment Status") rather than data.
 * @param {string} text
 */
export function isFieldLabel(text) {
  const normalised = normaliseKey(text);
  return Boolean(normalised) && (OTHER_LABELS.has(normalised) || FIELDS.some(([pattern]) => pattern.test(normalised)));
}

/**
 * Whether a value plausibly holds data of that kind, so schemas, types,
 * labels and package names are not redacted.
 * @param {Field} field
 * @param {string} value
 */
function isValueFor(field, value) {
  const v = value.trim();
  if (!v || v.length > 120 || isPlaceholder(v) || TYPE_WORDS.test(v) || EMPTY_VALUE.test(v) || isFieldLabel(v)) {
    return false;
  }
  switch (field.kind) {
    case "name":
      // A real name: 1-5 words of letters, each capitalised.
      return /^\p{Lu}[\p{L}'’.-]*(?:\s+(?:\p{Lu}[\p{L}'’.-]*|de|del|da|di|van|von|der|la|le|al|bin))*$/u.test(v) && v.split(/\s+/).length <= 5;
    case "phone":
      return /^[+\d()][\d\s().-]{5,}$/.test(v) && v.replace(/\D/g, "").length >= 7;
    case "place":
      return /^\p{Lu}[\p{L}'’. -]{1,40}$/u.test(v);
    case "address":
      // Street text, not a host:port or an IP address.
      return /\p{L}{2}/u.test(v) && (/\d/.test(v) || v.split(/\s+/).length >= 2) && !/^\d{1,3}(?:\.\d{1,3}){3}/.test(v);
    case "date":
      return DATE_VALUE.test(v);
    case "plate":
      return /\d/.test(v) && /^[A-Z0-9][A-Z0-9 -]{2,16}$/i.test(v);
    case "digits":
      return /^\d{3,8}$/.test(v);
    case "code":
      // IBAN or SWIFT/BIC: capitals and digits; a BIC may be letters only.
      return /^[A-Z0-9][A-Z0-9 -]{5,40}$/.test(v) && /[A-Z]{4}/.test(v);
    case "secret":
      return !/\s/.test(v) && isPasswordToken(v);
    default:
      return /\d/.test(v) && v.split(/\s+/).length <= 6;
  }
}

// Where a value in running text ends: the next field on the same line.
const VALUE_STOP = /\n|\s\|\s?|\|\s|\*\*|__|;|\s[-–—]\s/;
const MAX_VALUE = 150;

/**
 * "Label: value" anywhere on a line, including Markdown ("**Label:**
 * value") and several fields on one line ("- First Name: Louise - Last
 * Name: Clay", "Customer ID: C1, License Plate: H02-3755").
 * @param {string} text
 * @param {Collector} out
 */
function collectLabelledFields(text, out) {
  for (let colon = text.indexOf(":"); colon !== -1; colon = text.indexOf(":", colon + 1)) {
    const next = text[colon + 1] || "";
    // URLs, times, IPv6 and "::" are not labels.
    if (next === "/" || next === ":" || text[colon - 1] === ":" || (/\d/.test(text[colon - 1] || "") && /\d/.test(next))) {
      continue;
    }
    const field = labelBefore(text, colon);
    if (!field) {
      continue;
    }
    const range = valueAfter(text, colon + 1);
    if (range) {
      addValue(text, out, field, range.start, range.end, "high");
    }
  }
}

/**
 * The field named by the words just before a colon, if any.
 * @param {string} text
 * @param {number} colon
 * @returns {Field | null}
 */
function labelBefore(text, colon) {
  const lineStart = text.lastIndexOf("\n", colon - 1) + 1;
  let segment = text.slice(Math.max(lineStart, colon - 70), colon).replace(/[\s*_`]+$/, "").replace(/\s*\([^()]{0,40}\)$/, "");
  // Only the text after the previous field or separator on the line.
  segment = segment.split(/\*\*|__|\||;|,|•|\s[-–—]\s|\.\s|["'{}[\]]/).pop() || "";
  segment = segment.replace(/^[\s>*+-]*(?:\d+[.)]\s*)?/, "").trim();
  const words = segment.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8) {
    return null;
  }
  // The whole segment, or at least two words at its end ("Policyholder First
  // Name", "The patient's Medical Record Number").
  for (let first = 0; first < words.length && (first === 0 || words.length - first >= 2); first += 1) {
    const field = fieldFor(words.slice(first).join(" "));
    if (field) {
      return field;
    }
  }
  return null;
}

/**
 * The value after a label: up to the end of the line, a separator, or the
 * next "Label:" on the same line.
 * @param {string} text
 * @param {number} from
 * @returns {{ start: number, end: number } | null}
 */
function valueAfter(text, from) {
  let start = from;
  while (start < text.length && /[ \t*_]/.test(text[start])) {
    start += 1;
  }
  const window = text.slice(start, start + MAX_VALUE);
  const stop = VALUE_STOP.exec(window);
  let value = stop ? window.slice(0, stop.index) : window;
  // The next field on the line: ", Label Words:" or " Label Words:".
  const nextLabel = /(?:,\s*|\s+)(?:\p{Lu}[\p{L}'’]*(?:\s+(?:\p{Lu}[\p{L}'’]*|of|ID|No\.?|#))*)\s*(?:\([^()\n]{0,40}\))?:/u.exec(value);
  if (nextLabel) {
    value = value.slice(0, nextLabel.index);
  }
  value = value.replace(/[\s,.;:*_]+$/, "");
  return value ? { start, end: start + value.length } : null;
}

/**
 * Adds a value, trimming wrapping quotes and Markdown. For identifiers,
 * keeps only the leading list of identifiers ("C387265419 indicates...").
 * @param {string} text
 * @param {Collector} out
 * @param {Field} field
 * @param {number} start
 * @param {number} end
 * @param {import("./util.js").Confidence} confidence
 */
function addValue(text, out, field, start, end, confidence) {
  let value = text.slice(start, end);
  const lead = /^["'“‘`*_]+/.exec(value);
  if (lead) {
    start += lead[0].length;
    value = value.slice(lead[0].length);
  }
  value = value.replace(/["'”’`*_]+$/, "");
  end = start + value.length;

  if ((field.kind === "id" || field.kind === "plate" || field.kind === "date") && value.split(/\s+/).length > 3) {
    const list = idList(value, field.kind);
    if (!list) {
      return;
    }
    end = start + list;
    value = value.slice(0, list);
  }
  if (isValueFor(field, value)) {
    out.add(start, end, field.type, field.category, confidence);
  }
}

// An identifier in running text: letters and digits with at least four
// digits ("C387265419", "MRN-450486", "3FJ8-KP2-LR95", "4567 892 314 XY").
const ID_TOKEN = "(?:[A-Z]{1,6}[- ]?)?\\d[A-Z0-9]*(?:[-/.][A-Z0-9]+|\\s(?=\\d)\\d+|\\s[A-Z]{1,3}(?![\\p{L}\\d])){0,5}";
const DATE_TOKEN = "(?:\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\p{L}{3,9}\\.?\\s\\d{1,2}(?:st|nd|rd|th)?,?\\s\\d{4}|\\d{1,2}\\s\\p{L}{3,9}\\.?\\s\\d{4})";
const ID_AT_START = new RegExp(`^${ID_TOKEN}(?![\\p{L}\\d])`, "u");
const DATE_AT_START = new RegExp(`^${DATE_TOKEN}(?![\\p{L}\\d])`, "u");
const DIGITS_AT_START = /^\d{3,8}(?![\p{L}\d])/u;
// SWIFT/BIC: bank, country, location, optional branch.
const BIC_AT_START = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?(?![\p{L}\d])/u;
const SECRET_AT_START = /^[^\s,;'"`<>()[\]{}]{4,64}/;
const LIST_JOIN = /^(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or|&)\s+|\s*\/\s*)/;

/**
 * Length of the value of that kind at the start of the text, or 0.
 * @param {string} text
 * @param {ValueKind} kind
 */
function tokenLength(text, kind) {
  switch (kind) {
    case "date":
      return (DATE_AT_START.exec(text) || [""])[0].length;
    case "digits":
      return (DIGITS_AT_START.exec(text) || [""])[0].length;
    case "code":
      return (BIC_AT_START.exec(text) || [""])[0].length;
    case "secret": {
      const match = SECRET_AT_START.exec(text);
      const value = match ? match[0].replace(/[.:!?]+$/, "") : "";
      return isPasswordToken(value) ? value.length : 0;
    }
    default: {
      const match = ID_AT_START.exec(text);
      return match && isIdToken(match[0]) ? match[0].length : 0;
    }
  }
}

/**
 * Length of the list of values of that kind at the start of a value
 * ("P9779023 and J-175274-E"), or 0 if it does not start with one.
 * @param {string} value
 * @param {ValueKind} kind
 */
function idList(value, kind) {
  let length = tokenLength(value, kind);
  if (!length || kind === "secret") {
    return length;
  }
  let rest = value.slice(length);
  for (;;) {
    const join = LIST_JOIN.exec(rest);
    const next = join ? tokenLength(rest.slice(join[0].length), kind) : 0;
    if (!join || !next) {
      return length;
    }
    length += join[0].length + next;
    rest = rest.slice(join[0].length + next);
  }
}

/**
 * A password-like value: no spaces, and a digit, a symbol or mixed case, so
 * "the password policy" or "password reset" are not taken as passwords.
 * @param {string} value
 */
function isPasswordToken(value) {
  return (
    value.length >= 4 &&
    !isPlaceholder(value) &&
    (/\d/.test(value) || /[^\p{L}\d]/u.test(value) || /\p{Ll}\p{Lu}/u.test(value)) &&
    !/^(?:https?:|www\.|\/)|^[\w.+-]+@[\w-]+\.[\w.]+$/i.test(value) &&
    !/^\d{1,3}$/.test(value) &&
    // Code that refers to a secret: "=DB_PASSWORD", "form.password.value",
    // "process.env.DB_PASS", "$DB_PASSWORD".
    !/^[=.:@$%{\\]/.test(value) &&
    !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value) &&
    !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value)
  );
}

/** @param {string} token */
function isIdToken(token) {
  const digits = token.replace(/\D/g, "").length;
  // Not a year, a date, an amount or a plain small number.
  return digits >= 4 && token.length <= 32 && !/^(?:19|20)\d{2}$/.test(token) && !new RegExp(`^${DATE_TOKEN}$`, "u").test(token);
}

// Label phrases in running text, followed by the value within the same
// sentence: "the account number is C387265419", "SSN 247 207 665",
// "Employee IDs P9779023 and J-175274-E", "born on 1960-11-14 and 1975-04-21".
/** @type {[RegExp, Field][]} */
const LABEL_PHRASES = [
  [/\b(?:bank\s+)?account\s+(?:numbers?|nos?\.?|#)|\bacct\.?\s+(?:numbers?|nos?\.?|#)/gi, { type: "BANK_ACCOUNT", category: "financial", kind: "id" }],
  [/\b(?:bank\s+)?routing\s+numbers?|\bABA\s+(?:routing\s+)?numbers?/gi, { type: "ROUTING_NUMBER", category: "financial", kind: "id" }],
  [/\b(?:credit|debit|credit\s+debit|payment)\s+card(?:\s+numbers?)?|\bcard\s+numbers?/gi, { type: "CARD_NUMBER", category: "financial", kind: "id" }],
  [/\b(?:policy|member|subscriber|insurance)\s+(?:numbers?|ids?|nos?\.?|#)|\b(?:health\s+plan\s+)?beneficiary\s+(?:numbers?|ids?)/gi, { type: "RECORD_ID", category: "governmentIds", kind: "id" }],
  [/\bmedical\s+records?(?:\s+numbers?)?|\bMRNs?\b|\bpatient\s+(?:records?|ids?|numbers?)/gi, { type: "RECORD_ID", category: "governmentIds", kind: "id" }],
  [/\b(?:employee|staff|badge|student)\s+(?:ids?|numbers?|nos?\.?|#)/gi, { type: "RECORD_ID", category: "governmentIds", kind: "id" }],
  [/\b(?:certificate(?:\s+licen[cs]e)?|licen[cs]e|professional\s+licen[cs]e)\s+numbers?/gi, { type: "RECORD_ID", category: "governmentIds", kind: "id" }],
  [/\bSSNs?\b|\bsocial\s+security(?:\s+numbers?)?/gi, { type: "SSN", category: "governmentIds", kind: "id" }],
  [/\blicen[cs]e\s+plates?|\bplate\s+numbers?|\bvehicle\s+registration(?:\s+numbers?)?/gi, { type: "LICENSE_PLATE", category: "governmentIds", kind: "id" }],
  [/\bdates?\s+of\s+birth|\bDOBs?\b|\bbirth\s?dates?|\bborn\s+on/gi, { type: "DOB", category: "governmentIds", kind: "date" }],
  [/\bswift(?:\s*\/?\s*bic)?(?:\s+code)?\b|\bBIC(?:\s+code)?\b/gi, { type: "SWIFT_BIC", category: "financial", kind: "code" }],
  [/\b(?:cvv2?|cvc2?|card\s+security\s+code)\b/gi, { type: "CARD_CVV", category: "financial", kind: "digits" }],
  [/\bPINs?\b(?:\s+(?:code|number))?/gi, { type: "PIN", category: "credentials", kind: "digits" }],
  [/\b(?:pass(?:word|code|phrase)|pwd)s?\b/gi, { type: "PASSWORD", category: "credentials", kind: "secret" }]
];
// Words allowed between a label phrase and its value.
const PHRASE_GAP = /^(?:[\s:#(,-]|\b(?:is|was|are|were|of|number|numbers|no\.?|code|which|the|new|valid|temporary|such as|e\.g\.,?|i\.e\.,?|like|including|ending in|listed as|on file|provided|registered|used|below|as)\b)*/i;

// A short clause between a label phrase and its value, ending in "is/was".
const LINKING_CLAUSE = /^(?:associated\s+with|linked\s+to|on\s+file\s+for|assigned\s+to|belonging\s+to|for|of)\s+(?:[^\s.;:!?]+\s+){0,4}?(?:is|was|are|were)\s*[:#]?\s*/i;

/**
 * @param {string} text
 * @param {Collector} out
 */
function collectLabelPhrases(text, out) {
  for (const [regex, field] of LABEL_PHRASES) {
    for (const match of text.matchAll(regex)) {
      const index = /** @type {number} */ (match.index);
      const after = index + match[0].length;
      // A word in prose, not part of code ("form.password.value", "password=x").
      if (/[.\w$:/]/.test(text[index - 1] || "") || /[.=_(\w@/]/.test(text[after] || "")) {
        continue;
      }
      const gap = PHRASE_GAP.exec(text.slice(after, after + 60));
      let start = after + (gap ? gap[0].length : 0);
      // "... associated with this customer is C387265419"
      const clause = LINKING_CLAUSE.exec(text.slice(start, start + 80));
      if (clause) {
        start += clause[0].length;
      }
      const window = text.slice(start, start + MAX_VALUE).split(/\n|[.;!?](?:\s|$)/)[0];
      const length = idList(window, field.kind);
      if (length) {
        out.add(start, start + length, field.type, field.category, "medium");
      }
    }
  }
}

/**
 * CSV, TSV, semicolon-separated and Markdown tables: a header row over
 * columns, or two-column "label | value" rows.
 * @param {string} text
 * @param {Collector} out
 */
function collectTables(text, out) {
  const lines = text.split("\n");
  let offset = 0;
  /** @type {{ separator: string, columns: (Field | null)[] } | null} */
  let table = null;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    if (!line.trim()) {
      table = null;
      continue;
    }
    if (/^\s*\|?\s*:?-{3,}/.test(line)) {
      continue;
    }

    if (table) {
      const cells = splitCells(line, table.separator);
      for (let i = 0; i < cells.length && i < table.columns.length; i += 1) {
        const field = table.columns[i];
        if (field) {
          addValue(line, collectorAt(out, lineStart), field, cells[i].start, cells[i].end, "high");
        }
      }
      continue;
    }

    const separator = ["\t", "|", ";", ","].find((sep) => line.split(sep).length >= 2);
    if (!separator) {
      continue;
    }
    const cells = splitCells(line, separator);
    const filled = cells.filter((cell) => cell.value);

    // "| Last Name | Holden |": a label and its value, not a header row.
    if (filled.length === 2 && !isFieldLabel(filled[1].value)) {
      const field = fieldFor(filled[0].value);
      if (field) {
        addValue(line, collectorAt(out, lineStart), field, filled[1].start, filled[1].end, "high");
      }
      continue;
    }

    const headers = cells.map((cell) => cell.value.replace(/^["']|["']$/g, "").replace(/\*\*/g, ""));
    // A header row is short labels, not a sentence that happens to contain commas.
    if (!headers.every((header) => /^[\p{L}\d _.#/()-]{0,40}$/u.test(header) && header.split(/\s+/).length <= 4)) {
      continue;
    }
    const columns = headers.map(fieldFor);
    if (columns.some(Boolean)) {
      table = { separator, columns };
    }
  }
}

/**
 * A view of the collector that takes positions relative to one line.
 * @param {Collector} out
 * @param {number} lineStart
 */
function collectorAt(out, lineStart) {
  return /** @type {Collector} */ (/** @type {unknown} */ ({
    add: (/** @type {number} */ start, /** @type {number} */ end, /** @type {string} */ type, /** @type {Category} */ category, /** @type {import("./util.js").Confidence} */ confidence) =>
      out.add(lineStart + start, lineStart + end, type, category, confidence)
  }));
}

/**
 * @param {string} line
 * @param {string} separator
 * @returns {{ value: string, start: number, end: number }[]}
 */
function splitCells(line, separator) {
  const cells = [];
  let start = 0;
  const trimmedLine = separator === "|" ? line.replace(/^\s*\|/, (m) => " ".repeat(m.length)).replace(/\|\s*$/, (m) => " ".repeat(m.length)) : line;
  for (let i = 0; i <= trimmedLine.length; i += 1) {
    if (i === trimmedLine.length || trimmedLine[i] === separator) {
      const raw = trimmedLine.slice(start, i);
      const leading = raw.length - raw.trimStart().length;
      const value = raw.trim().replace(/^"(.*)"$/, "$1");
      const valueStart = start + leading + (raw.trim().startsWith("\"") ? 1 : 0);
      cells.push(value ? { value, start: valueStart, end: valueStart + value.length } : { value: "", start: i, end: i });
      start = i + 1;
    }
  }
  return cells;
}
