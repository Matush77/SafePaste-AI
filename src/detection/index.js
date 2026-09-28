// Runs every detector and turns their candidates into the final spans.

import { detectAddresses } from "./addresses.js";
import { detectContact } from "./contact.js";
import { detectEntities } from "./entities.js";
import { detectFinancial } from "./financial.js";
import { detectGitleaks } from "./gitleaks.js";
import { detectGovernmentIds } from "./governmentIds.js";
import { detectNetwork } from "./network.js";
import { detectSecrets } from "./secrets.js";
import { detectStructured } from "./structured.js";

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

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;

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
    (candidate) => settings.categories[candidate.category] && CONFIDENCE_RANK[candidate.confidence] >= minimum
  );
  return mergeOverlaps(text, kept);
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
