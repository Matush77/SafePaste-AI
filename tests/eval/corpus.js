// Loads tests/eval/corpus/*.txt into samples with gold spans.
// Format and labelling rules: tests/eval/GUIDELINES.md.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS } from "../../src/redactor.js";

/**
 * @typedef {import("../../src/redactor.js").Category} Category
 * @typedef {{ start: number, end: number, category: Category, value: string }} GoldSpan
 * @typedef {{ id: string, file: string, benign: boolean, text: string, gold: GoldSpan[] }} Sample
 */

const CORPUS_DIR = fileURLToPath(new URL("./corpus/", import.meta.url));
const CATEGORIES = new Set(Object.keys(DEFAULT_SETTINGS.categories));
const LABEL = /«(\w+):([^«»]*)»/g;

/** @returns {Sample[]} */
export function loadCorpus(dir = CORPUS_DIR) {
  const samples = [];
  const ids = new Set();

  for (const file of readdirSync(dir).filter((name) => name.endsWith(".txt")).sort()) {
    const benign = file.startsWith("benign-");
    const content = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
    const chunks = content.split(/^=== (.+)$/m);
    if (chunks[0].trim()) {
      throw new Error(`${file}: text before the first "=== id" header`);
    }

    for (let i = 1; i < chunks.length; i += 2) {
      const id = chunks[i].trim();
      if (ids.has(id)) {
        throw new Error(`${file}: duplicate sample id ${id}`);
      }
      ids.add(id);

      const sample = parseSample(id, file, benign, chunks[i + 1].replace(/^\n/, "").replace(/\n+$/, ""));
      if (benign && sample.gold.length) {
        throw new Error(`${file}: benign sample ${id} contains labels`);
      }
      samples.push(sample);
    }
  }

  return samples;
}

/**
 * @param {string} id
 * @param {string} file
 * @param {boolean} benign
 * @param {string} marked
 * @returns {Sample}
 */
function parseSample(id, file, benign, marked) {
  /** @type {GoldSpan[]} */
  const gold = [];
  let text = "";
  let cursor = 0;

  for (const match of marked.matchAll(LABEL)) {
    const [whole, category, value] = match;
    if (!CATEGORIES.has(category)) {
      throw new Error(`${file} ${id}: unknown category "${category}"`);
    }
    if (!value.trim()) {
      throw new Error(`${file} ${id}: empty label`);
    }
    text += marked.slice(cursor, match.index);
    gold.push({ start: text.length, end: text.length + value.length, category: /** @type {Category} */ (category), value });
    text += value;
    cursor = /** @type {number} */ (match.index) + whole.length;
  }
  text += marked.slice(cursor);

  if (/[«»]/.test(text)) {
    throw new Error(`${file} ${id}: unbalanced label markers`);
  }

  return { id, file, benign, text, gold };
}
