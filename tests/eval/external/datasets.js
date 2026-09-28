// Public labelled PII datasets, converted to evaluation samples.
//
// Rows are fetched from the Hugging Face datasets server and cached in
// .cache/eval-datasets/ (git-ignored: the data is not redistributed here).
//
//   nvidia/Nemotron-PII                 CC BY 4.0, character offsets per value
//   gretelai/gretel-pii-masking-en-v1   Apache-2.0, values listed per document
//
// Labels map onto the extension's categories. Labels outside what the
// extension aims to redact (dates, ages, job titles, sensitive traits...) are
// "neutral": redacting them is neither rewarded nor counted as an error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {import("../corpus.js").Sample} Sample
 * @typedef {import("../corpus.js").Category} Category
 */

const CACHE_DIR = fileURLToPath(new URL("../../../.cache/eval-datasets/", import.meta.url));
const ROWS_API = "https://datasets-server.huggingface.co/rows";
const PAGE = 100;

/** @type {Record<string, Category>} */
const LABELS = {
  first_name: "people",
  last_name: "people",
  name: "people",
  email: "emails",
  phone_number: "phones",
  fax_number: "phones",
  street_address: "addresses",
  address: "addresses",
  postcode: "addresses",
  city: "locations",
  county: "locations",
  coordinate: "locations",
  company_name: "organizations",
  account_number: "financial",
  credit_debit_card: "financial",
  credit_card_number: "financial",
  bank_routing_number: "financial",
  swift_bic: "financial",
  cvv: "financial",
  ssn: "governmentIds",
  national_id: "governmentIds",
  tax_id: "governmentIds",
  date_of_birth: "governmentIds",
  medical_record_number: "governmentIds",
  health_plan_beneficiary_number: "governmentIds",
  certificate_license_number: "governmentIds",
  license_plate: "governmentIds",
  employee_id: "governmentIds",
  password: "credentials",
  pin: "credentials",
  http_cookie: "credentials",
  api_key: "apiKeys",
  ipv: "network",
  mac_address: "network"
};

export const DATASETS = {
  nemotron: { id: "nvidia/Nemotron-PII", split: "test", convert: convertNemotron },
  gretel: { id: "gretelai/gretel-pii-masking-en-v1", split: "test", convert: convertGretel }
};

// Rows 0-499 are the development set: misses may be inspected and rules
// improved against them. Rows 1000-1499 are the test set: only its totals
// are ever looked at, so it stays an honest measure.
export const SETS = { dev: { offset: 0, count: 500 }, test: { offset: 1000, count: 500 } };

/**
 * @param {keyof typeof DATASETS} name
 * @param {keyof typeof SETS} set
 * @returns {Promise<Sample[]>}
 */
export async function loadDataset(name, set) {
  const dataset = DATASETS[name];
  const { offset, count } = SETS[set];
  const rows = await fetchRows(dataset.id, dataset.split, offset, count);
  return rows.map((row, index) => dataset.convert(row, `${name}/${offset + index}`)).filter((sample) => sample !== null);
}

/**
 * @param {string} id
 * @param {string} split
 * @param {number} start
 * @param {number} count
 * @returns {Promise<any[]>}
 */
async function fetchRows(id, split, start, count) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${id.replace("/", "__")}-${split}-${start}-${count}.json`);
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf8"));
  }

  const rows = [];
  for (let offset = start; offset < start + count; offset += PAGE) {
    const url = `${ROWS_API}?dataset=${encodeURIComponent(id)}&config=default&split=${split}&offset=${offset}&length=${Math.min(PAGE, start + count - offset)}`;
    const response = await fetchWithRetry(url);
    const page = await response.json();
    rows.push(...page.rows.map((/** @type {{ row: any }} */ item) => item.row));
  }
  writeFileSync(cacheFile, JSON.stringify(rows));
  return rows;
}

/** @param {string} url */
async function fetchWithRetry(url) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      return response;
    }
    if (attempt === 4) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

/**
 * Nemotron stores spans as Python-style text with character offsets.
 * @param {any} row
 * @param {string} id
 * @returns {Sample | null}
 */
function convertNemotron(row, id) {
  if (row.locale !== "us") {
    return null;
  }
  const spans = [...row.spans.matchAll(/['"]start['"]: (\d+), ['"]end['"]: (\d+),.*?['"]label['"]: ['"]([a-z_]+)['"]/g)]
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]), label: match[3] }));
  return toSample(id, row.text, spans);
}

/**
 * Gretel lists each value once with its types; every occurrence in the text
 * is labelled.
 * @param {any} row
 * @param {string} id
 * @returns {Sample}
 */
function convertGretel(row, id) {
  const spans = [];
  for (const match of row.entities.matchAll(/['"]entity['"]: (['"])(.*?)\1, ['"]types['"]: \[([^\]]*)\]/g)) {
    const value = match[2];
    const label = (/[a-z_]+/.exec(match[3]) || ["unknown"])[0];
    for (let index = row.text.indexOf(value); index !== -1 && value; index = row.text.indexOf(value, index + value.length)) {
      spans.push({ start: index, end: index + value.length, label });
    }
  }
  return toSample(id, row.text, spans);
}

/**
 * @param {string} id
 * @param {string} text
 * @param {{ start: number, end: number, label: string }[]} spans
 * @returns {Sample}
 */
function toSample(id, text, spans) {
  const gold = [];
  const neutral = [];
  for (const span of spans) {
    const category = LABELS[span.label];
    if (category) {
      gold.push({ start: span.start, end: span.end, category, value: text.slice(span.start, span.end) });
    } else {
      neutral.push({ start: span.start, end: span.end });
    }
  }
  return { id, file: `external/${id.split("/")[0]}`, benign: gold.length === 0, text, gold, neutral };
}
