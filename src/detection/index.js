// Runs every detector and turns their candidates into the final spans.

import { detectAddresses } from "./addresses.js";
import { detectContact } from "./contact.js";
import { detectEntities } from "./entities.js";
import { detectFinancial } from "./financial.js";
import { detectGitleaks } from "./gitleaks.js";
import { detectGovernmentIds } from "./governmentIds.js";
import { detectNetwork } from "./network.js";
import { detectSecrets } from "./secrets.js";
import { detectStructured, isFieldLabel } from "./structured.js";
import { FIRST_NAMES, normaliseName } from "./data/firstNames.js";
import { COMMON_FIRST_NAMES, NAME_WORDS, SURNAMES } from "./data/names.js";
import { NOT_NAME } from "./entities.js";

/**
 * @typedef {import("./util.js").Candidate} Candidate
 * @typedef {import("../redactor.js").Settings} Settings
 * @typedef {import("../redactor.js").Match} Match
 */

const DETECTORS = [detectSecrets, detectGitleaks, detectContact, detectFinancial, detectGovernmentIds, detectNetwork, detectAddresses, detectStructured, detectEntities];

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
const MINIMUM_RANK = { balanced: 1, strict: 0 };

// When spans overlap, the merged span keeps the label of the category that
// matters most for safety.
const CATEGORY_PRIORITY = [
  "apiKeys", "credentials", "financial", "governmentIds", "emails", "phones", "network", "addresses", "people",
  "organizations", "locations", "urls"
];

// Categories whose rules can mistake a form or column label ("Last Name",
// "Employment Status") for data.
const LABEL_PRONE = new Set(["people", "organizations", "locations"]);

const URL_PATTERN =/\bhttps?:\/\/[^\s<>"'`]+/gi;

/**
 * @param {string} text
 * @param {Settings} settings
 * @param {Candidate[]} [extra] Candidates from other sources, e.g. the NER model.
 * @returns {Match[]}
 */
export function detectAll(text, settings, extra = []) {
  const minimum = MINIMUM_RANK[settings.sensitivity] ?? MINIMUM_RANK.balanced;
  const candidates = [...extra];
  for (const detector of DETECTORS) {
    candidates.push(...detector(text));
  }
  if (settings.categories.urls) {
    for (const match of text.matchAll(URL_PATTERN)) {
      const index = /** @type {number} */ (match.index);
      const value = match[0].replace(/[.,;:!?)\]}]+$/, "");
      candidates.push({ start: index, end: index + value.length, type: "URL", category: "urls", confidence: "high" });
    }
  }

  promoteNearPersonalData(candidates);
  const kept = candidates.filter(
    (candidate) => settings.categories[candidate.category] && CONFIDENCE_RANK[candidate.confidence] >= minimum &&
      !(LABEL_PRONE.has(candidate.category) && isFieldLabel(text.slice(candidate.start, candidate.end)))
  );
  kept.push(...repeatedNames(text, kept));
  return mergeOverlaps(text, kept);
}

/** @param {string} name Normalised. */
function isKnownNamePart(name) {
  return FIRST_NAMES.has(name) || COMMON_FIRST_NAMES.has(name) || SURNAMES.has(name);
}

const NAME_TOKEN =/(?<![\p{L}\d'’-])\p{Lu}[\p{L}'’-]{2,}(?![\p{L}\d'’-])/gu;

/**
 * "Toni Levine ... Toni was born": once a name is found, its parts are
 * redacted wherever else they appear, so the rest of the text does not give
 * the name away. Parts that are also ordinary words ("Will", "Grace") only
 * count where they cannot be a capitalised sentence start.
 * @param {string} text
 * @param {Candidate[]} kept
 * @returns {Candidate[]}
 */
function repeatedNames(text, kept) {
  /** @type {Map<string, import("./util.js").Confidence>} */
  const parts = new Map();
  for (const candidate of kept) {
    if (candidate.category !== "people") {
      continue;
    }
    const tokens = [...text.slice(candidate.start, candidate.end).matchAll(NAME_TOKEN)].map((match) => match[0]);
    // A mistaken match ("Information Sheet") must not spread, so only known
    // name parts spread, or parts of a confident multi-word name.
    const trusted = candidate.confidence === "high" && tokens.length >= 2;
    for (const part of tokens) {
      const name = normaliseName(part);
      const known = parts.get(part);
      if ((trusted || isKnownNamePart(name)) && !NOT_NAME.has(name) && !isFieldLabel(part) && (!known || CONFIDENCE_RANK[candidate.confidence] > CONFIDENCE_RANK[known])) {
        parts.set(part, candidate.confidence);
      }
    }
  }
  if (!parts.size) {
    return [];
  }
  /** @type {Candidate[]} */
  const found = [];
  for (const match of text.matchAll(NAME_TOKEN)) {
    const confidence = parts.get(match[0]);
    if (!confidence) {
      continue;
    }
    const index = /** @type {number} */ (match.index);
    if (NAME_WORDS.has(normaliseName(match[0])) && /(?:^|[.!?:\n]\s*|\n\s*[-*•]?\s*)$/.test(text.slice(Math.max(0, index - 4), index))) {
      continue;
    }
    found.push({ start: index, end: index + match[0].length, type: "PERSON", category: "people", confidence });
  }
  return found;
}

// How close (in characters) other personal data must be for a place or
// institution name to count as part of someone's personal data.
const CONTEXT_WINDOW = 150;
const ANCHOR_CATEGORIES = new Set(["people", "emails", "phones", "addresses", "governmentIds", "financial", "organizations"]);

/**
 * "Destination is Singapore and the contact email is priya@..." redacts
 * Singapore; "From New York to Paris" does not. Contextual candidates become
 * medium confidence when a confident personal-data candidate is nearby.
 * @param {Candidate[]} candidates
 */
function promoteNearPersonalData(candidates) {
  const anchors = candidates.filter(
    (candidate) => !candidate.contextual && candidate.source !== "model" &&
      (ANCHOR_CATEGORIES.has(candidate.category) || candidate.type === "COORDINATES") &&
      CONFIDENCE_RANK[candidate.confidence] >= 1
  );
  for (const candidate of candidates) {
    if (!candidate.contextual) {
      continue;
    }
    const near = anchors.some(
      (anchor) => anchor.start < candidate.end + CONTEXT_WINDOW && anchor.end > candidate.start - CONTEXT_WINDOW &&
        !(anchor.start < candidate.end && anchor.end > candidate.start)
    );
    if (near) {
      candidate.confidence = "medium";
    }
  }
}

/**
 * Overlapping spans are merged into one, so no fragment of either leaks.
 * @param {string} text
 * @param {Candidate[]} candidates
 * @returns {Match[]}
 */
function mergeOverlaps(text, candidates) {
  const sorted = [...candidates].sort((a, b) => a.start - b.start || b.end - a.end);
  /** @type {Candidate[]} */
  const merged = [];
  for (const candidate of sorted) {
    const last = merged[merged.length - 1];
    if (last && candidate.start < last.end) {
      if (candidate.end > last.end) {
        last.end = candidate.end;
      }
      if (priority(candidate) < priority(last) || (priority(candidate) === priority(last) && length(candidate) > length(last))) {
        last.type = candidate.type;
        last.category = candidate.category;
      }
      continue;
    }
    merged.push({ ...candidate });
  }
  return merged.map(({ start, end, type, category }) => ({ start, end, type, category, value: text.slice(start, end) }));
}

/** @param {Candidate} candidate */
function priority(candidate) {
  return CATEGORY_PRIORITY.indexOf(candidate.category);
}

/** @param {Candidate} candidate */
function length(candidate) {
  return candidate.end - candidate.start;
}
