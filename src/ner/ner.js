// Turns the output of a token-classification (NER) model into detection
// candidates. Shared by the extension (offscreen document) and the Node
// evaluation, so both score exactly the same logic. The model itself is
// loaded by the caller; this file has no dependency on transformers.js.

/**
 * @typedef {import("../detection/util.js").Candidate} Candidate
 *
 * @typedef {object} TokenPrediction   One item of transformers.js token-classification output.
 * @property {string} entity            e.g. "B-PER", "I-ORG"
 * @property {number} score
 * @property {number} index             Token position.
 * @property {string} word              Token text, "##" prefix for word pieces.
 *
 * @typedef {(text: string) => Promise<TokenPrediction[]>} TokenClassifier
 *
 * @typedef {object} NerOptions
 * @property {number} [minScore]        Minimum mean token score for an entity.
 * @property {number} [chunkSize]       Maximum characters sent to the model at once.
 */

import { normaliseName } from "../detection/data/firstNames.js";
import { NOT_NAME } from "../detection/entities.js";

// Model labels to engine categories. MISC is ignored.
const LABELS = /** @type {const} */ ({ PER: "people", ORG: "organizations", LOC: "locations" });

// Lines that are code: class names and identifiers are not people.
const CODE_LINE = /[{};]\s*$|=>|\bfunction\b|\bclass\s+\w|\bconst\s+\w|\bimport\s|\breturn\b|\w\.\w+\(|^\s*(?:def|public|private|async)\s/;

/**
 * @param {TokenClassifier} classify
 * @param {string} text
 * @param {NerOptions} [options]
 * @returns {Promise<Candidate[]>}
 */
export async function nerCandidates(classify, text, { minScore = 0.85, chunkSize = 1500 } = {}) {
  /** @type {Candidate[]} */
  const candidates = [];
  for (const chunk of chunks(text, chunkSize)) {
    if (!/\p{L}/u.test(chunk.text)) {
      continue;
    }
    const tokens = await classify(chunk.text);
    // Entities come in text order; search after the previous one so repeated
    // names map to their own occurrence.
    let cursor = 0;
    for (const entity of groupEntities(tokens)) {
      const span = locate(chunk.text, entity.words, cursor) || locate(chunk.text, entity.words, 0);
      if (!span) {
        continue;
      }
      cursor = span.end;
      if (entity.score < minScore) {
        continue;
      }
      const trimmed = trimNonNameWords(text, chunk.offset + span.start, chunk.offset + span.end);
      if (!trimmed || !isPlausibleEntity(text, trimmed.start, trimmed.end, entity.score)) {
        continue;
      }
      candidates.push(toCandidate(entity.label, trimmed.start, trimmed.end, entity.score));
    }
  }
  return candidates;
}

/**
 * Filters the model's typical mistakes on chat text.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {number} score
 */
function isPlausibleEntity(text, start, end, score) {
  const value = text.slice(start, end);
  const line = lineAt(text, start);
  if (CODE_LINE.test(line) || !/\p{L}{2}/u.test(value)) {
    return false;
  }
  // Acronyms and field names: DOB, IBAN, SSN.
  if (/^[\p{Lu}\d]{2,5}$/u.test(value)) {
    return false;
  }
  // A label at the start of a line: "Rodné číslo: 851203/4417".
  if (/^\s*[:：]/.test(text.slice(end)) && text.slice(text.lastIndexOf("\n", start - 1) + 1, start).trim() === "") {
    return false;
  }
  // One capitalised word opening a sentence is usually just a capitalised
  // word ("Castling requires...", "Pošli prosím..."); only very confident
  // predictions count there.
  const opensSentence = /(?:^|[.!?:]\s+|\n\s*)$/.test(text.slice(Math.max(0, start - 3), start)) || start === 0;
  if (opensSentence && !/\s/.test(value) && score < 0.97) {
    return false;
  }
  return true;
}

/**
 * Drops greetings and function words the model sometimes includes, e.g.
 * "Dobrý deň" or "Hi" before a name.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 */
function trimNonNameWords(text, start, end) {
  const words = [...text.slice(start, end).matchAll(/\S+/g)];
  let first = 0;
  let last = words.length;
  const isStop = (/** @type {RegExpMatchArray} */ word) => NOT_NAME.has(normaliseName(word[0].replace(/[^\p{L}]/gu, "")));
  while (first < last && isStop(words[first])) {
    first += 1;
  }
  while (last > first && isStop(words[last - 1])) {
    last -= 1;
  }
  if (first === last) {
    return null;
  }
  const firstWord = words[first];
  const lastWord = words[last - 1];
  return {
    start: start + /** @type {number} */ (firstWord.index),
    end: start + /** @type {number} */ (lastWord.index) + lastWord[0].length
  };
}

/**
 * Model people are redacted in Balanced mode. Model organisations and places
 * are only redacted in Strict mode: the model also tags "Microsoft", "Paris"
 * and technologies like "Kafka" in general text.
 * @param {"PER" | "ORG" | "LOC"} label
 * @param {number} start
 * @param {number} end
 * @param {number} score
 * @returns {Candidate}
 */
function toCandidate(label, start, end, score) {
  if (label === "PER") {
    return { start, end, type: "PERSON", category: LABELS.PER, confidence: score >= 0.95 ? "high" : "medium", source: "model" };
  }
  return { start, end, type: label === "ORG" ? "ORG" : "LOCATION", category: LABELS[label], confidence: "low", source: "model" };
}

/**
 * Merges B-/I- tokens and "##" word pieces into entities.
 * @param {TokenPrediction[]} tokens
 * @returns {{ label: "PER" | "ORG" | "LOC", words: string[], score: number }[]}
 */
function groupEntities(tokens) {
  /** @type {{ label: "PER" | "ORG" | "LOC", words: string[], scores: number[], lastIndex: number }[]} */
  const groups = [];
  for (const token of tokens) {
    const [prefix, label] = token.entity.includes("-") ? token.entity.split("-") : ["B", token.entity];
    if (!(label in LABELS)) {
      continue;
    }
    const last = groups[groups.length - 1];
    const continues = last && last.label === label && token.index === last.lastIndex + 1 && (prefix === "I" || token.word.startsWith("##"));
    if (continues) {
      if (token.word.startsWith("##")) {
        last.words[last.words.length - 1] += token.word.slice(2);
      } else {
        last.words.push(token.word);
      }
      last.scores.push(token.score);
      last.lastIndex = token.index;
    } else if (token.word.startsWith("##") && last && token.index === last.lastIndex + 1) {
      // A word piece tagged B- right after an entity of another type: glue it on.
      last.words[last.words.length - 1] += token.word.slice(2);
      last.lastIndex = token.index;
    } else {
      groups.push({ label: /** @type {"PER" | "ORG" | "LOC"} */ (label), words: [token.word], scores: [token.score], lastIndex: token.index });
    }
  }
  return groups.map((group) => ({
    label: group.label,
    words: group.words,
    score: group.scores.reduce((sum, score) => sum + score, 0) / group.scores.length
  }));
}

/**
 * Finds the entity's words in the text. Tokenizers may drop or split
 * punctuation, so words are matched in order with anything non-letter between.
 * @param {string} text
 * @param {string[]} words
 * @param {number} from
 */
function locate(text, words, from) {
  const pattern = words
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^\\p{L}\\p{N}]{0,3}");
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "u");
  const match = regex.exec(text.slice(from));
  return match ? { start: from + match.index, end: from + match.index + match[0].length } : null;
}

/**
 * Splits text at line boundaries into pieces the model can take at once.
 * @param {string} text
 * @param {number} size
 */
function chunks(text, size) {
  const pieces = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + size);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > offset) {
        end = newline + 1;
      }
    }
    pieces.push({ offset, text: text.slice(offset, end) });
    offset = end;
  }
  return pieces;
}

/**
 * @param {string} text
 * @param {number} index
 */
function lineAt(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}
