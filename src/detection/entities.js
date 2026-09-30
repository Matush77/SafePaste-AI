// People, organisations and locations, from rules. The local NER model adds
// to these when it is available (see src/ner/).

import { FIRST_NAMES, normaliseName } from "./data/firstNames.js";
import { COMMON_FIRST_NAMES, NAME_WORDS, SURNAMES } from "./data/names.js";
import { PLACE_NAMES } from "./data/places.js";
import { CAP_WORD, Collector } from "./util.js";

const H = "[^\\S\\r\\n]";

/**
 * Makes the letters of a trigger phrase case-insensitive while the name
 * pattern after it stays case-sensitive ("my name is" / "My Name Is", but
 * the name must still be capitalised).
 * @param {string} pattern
 */
function ci(pattern) {
  return pattern.replace(/\p{L}/gu, (char) => {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    return lower === upper ? char : `[${lower}${upper}]`;
  });
}
const PARTICLE = "(?:de|del|della|di|da|dos|du|van|von|der|den|ten|ter|la|le|al|el|bin|ibn|mac|st\\.?)";
// A middle initial: "Jeremy J. Smith".
const INITIAL = `(?:\\p{Lu}\\.${H}+)?`;
// "Jane Smith", "Siobhán Ní Bhriain", "Ludwig van Beethoven", "Kevin O'Brien"
const FULL_NAME = `${CAP_WORD}(?:${H}+(?:${PARTICLE}${H}+){0,2}${INITIAL}${CAP_WORD}){1,3}`;
const ANY_NAME = `${CAP_WORD}(?:${H}+(?:${PARTICLE}${H}+){0,2}${INITIAL}${CAP_WORD}){0,3}`;
const LOWER_NAME = "[a-z][a-z'’-]+(?:[^\\S\\r\\n]+[a-z][a-z'’-]+){0,2}";

// Capitalised words that start sentences or headings, never names.
export const NOT_NAME = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "i", "if", "in", "into", "it", "its", "of", "on", "or", "our", "the",
  "this", "that", "these", "those", "to", "we", "when", "where", "with", "you", "your", "my", "his", "her", "their", "all",
  "team", "everyone", "everybody", "folks", "guys", "there", "sir", "madam", "support", "customer", "customers", "client",
  "user", "users", "friend", "friends", "hello", "hi", "hey", "dear", "thanks", "thank", "regards", "best", "please",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april",
  "may", "june", "july", "august", "september", "october", "november", "december", "today", "tomorrow", "yesterday",
  "new", "old", "big", "small", "north", "south", "east", "west", "not", "no", "yes", "ok", "okay", "admin", "root", "api",
  // Roles used in greetings and sign-offs ("Dear Tenant", "Dear Vehicle Owner", "The Marketing Team").
  "recipient", "recipients", "tenant", "tenants", "applicant", "applicants", "member", "members", "patient", "patients",
  "owner", "owners", "vehicle", "potential", "valued", "colleague", "colleagues", "partner", "partners", "parent",
  "parents", "guardian", "resident", "residents", "employee", "employees", "student", "students", "candidate",
  "subscriber", "policyholder", "homeowner", "participant", "participants", "shareholder", "shareholders", "investor",
  "investors", "marketing", "hiring", "manager", "neighbor", "neighbour", "community", "staff", "board", "committee",
  "bonjour", "hola", "ciao", "hallo", "ahoj", "dobrý", "dobry", "deň", "den", "cześć", "hej", "salut", "servus", "grüß", "gott"
]);

const GREETING = new RegExp(`(?:^|(?<=[\\s>]))(?:Dear|Hi|Hello|Hey|Hallo|Bonjour|Hola|Ciao|Ahoj|Dobrý deň|Dobrý den|Cześć|Hej)${H}+(?:(?:Mr|Mrs|Ms|Miss|Dr|Prof)\\.?${H}+)?(${ANY_NAME})(?=${H}*[,!:\\n]|$)`, "dgmu");
// A sign-off starting its own line, then the name on the same line after a
// comma or alone on the next line.
const SIGN_OFF = new RegExp(`^${H}*${ci("(?:best|best regards|kind regards|warm regards|regards|many thanks|thanks|thank you|cheers|sincerely|yours|yours sincerely|all the best|s pozdravom|s pozdravem|mit freundlichen grüßen|cordialement|saludos|pozdrawiam)")}(?:,${H}*\\r?\\n${H}*|,${H}+|${H}*\\r?\\n${H}*)(${ANY_NAME})${H}*(?=\\r?\\n|$)`, "dgmu");
const TITLED = new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Herr|Frau|Mme|Mlle|Sr|Sra|Pan|Pani)\\.?${H}+(${ANY_NAME})`, "dgu");
// Phrases that are always followed by a name, even a lower-case one.
const INTRODUCTION = new RegExp(`\\b${ci("(?:my (?:first |last |full |middle |legal |given )?name is|name's|volám sa|volam sa|jmenuji se|je m'appelle|ich heiße|ich heisse|me llamo|mi chiamo|nazywam się|mein name ist)")}${H}+(${ANY_NAME}|${LOWER_NAME})(?=[\\s,.!;]|$)`, "dgu");
// Phrases that are often followed by other things ("I am happy", "This is Big
// Data"); these need a full name starting with a known first name.
const WEAK_INTRODUCTION = new RegExp(`\\b${ci("(?:i am|i'm|this is|je suis|ich bin|soy|sono)")}${H}+(${FULL_NAME})`, "dgu");
const LABEL = new RegExp(`^${H}*(?:[-*•]${H}*)?(?:From|To|Cc|Bcc|Name|Full name|Contact|Contact person|Customer|Client|Patient|Applicant|Employee|Candidate|Traveler|Traveller|Passenger|Guest|Tenant|Landlord|Payee|Beneficiary|Recipient|Sender|Owner|Attendees|Participants|Signed|Signed by|Author|Assignee|Reporter|Interviewer|Account holder|Cardholder|Referral|Policyholder)${H}*:${H}*(.+)$`, "dgimu");
const RELATION = new RegExp(`\\b${ci("(?:colleague|kolega|kolegyňa|coworker|co-worker|manager|boss|landlord|landlady|tenant|neighbou?r|wife|husband|partner|son|daughter|brother|sister|mother|father|mom|dad|friend|doctor|lawyer|attorney|accountant|contractor|interviewed|called|emailed|ask|msg to|message to|text|meeting with|met with|contact|policyholder|payee|recipient|signed by|reviewed by|approved by|sent by|written by|owned by|assigned to|cc)")}${H}+(${FULL_NAME})`, "dgu");
const DICTIONARY_NAME = new RegExp(`(?<![\\p{L}'’-])(${FULL_NAME})`, "gu");
// "I, Sabrina, am applying", "I, Jake Wiggins, authorize"
const SELF_IDENTIFICATION = new RegExp(`(?:^|(?<=[\\s(]))I,${H}+(${ANY_NAME}),`, "dgmu");
// Any capitalised word, for first names on their own.
const CAPITALISED_WORD = /(?<![\p{L}\d'’-])\p{Lu}\p{Ll}{2,}(?![\p{L}\d'’-])/gu;
const PLACE_WORDS = new Set(PLACE_NAMES.map((name) => normaliseName(name)));

const ORG_SUFFIX = "(?:Inc\\.?|Incorporated|LLC|L\\.L\\.C\\.|Ltd\\.?|Limited|Corp\\.?|Corporation|GmbH|AG|KG|OHG|AS|ASA|AB|Oy|Oyj|ApS|A/S|SA|S\\.A\\.|SAS|SARL|S\\.r\\.l\\.|Srl|SpA|S\\.p\\.A\\.|BV|B\\.V\\.|NV|N\\.V\\.|plc|PLC|Pty(?:\\.? Ltd\\.?)?|LLP|LP|s\\.r\\.o\\.|spol\\. s r\\.o\\.|a\\.s\\.|Sp\\. z o\\.o\\.|sp\\. z o\\.o\\.|S\\.A\\.S\\.|Kft\\.?|Zrt\\.?|Co\\.|& Co\\.?|Group|Holdings)";
const ORG_WORD = "(?:\\p{Lu}[\\p{L}\\d'’.-]*|&|and|und|of|the|de)";
const ORGANIZATION = new RegExp(`(?<![\\p{L}\\d])(?!The\\b)\\p{Lu}[\\p{L}\\d'’.-]*(?:${H}+${ORG_WORD}){0,5}${H}+${ORG_SUFFIX}(?![\\p{L}\\d])`, "gu");
const ORG_CONTEXT = new RegExp(`\\b(?:works? (?:at|for)|working (?:at|for)|employed (?:at|by)|employer:?|company:|vendor:?|supplier:?|insurer:?|carrier:?|client company|customer account)${H}+(${ORG_WORD.replace("|&|and|und|of|the|de", "")}(?:${H}+${ORG_WORD}){0,4})`, "dgu");

// Institutions: public ones ("Harvard University") are not personal data, so
// these only count next to other personal data.
const INSTITUTION = new RegExp(`(?<![\\p{L}\\d])(?!(?:The|My|Our|Your|His|Her|Their|This|That|Its)\\b)\\p{Lu}[\\p{L}\\d'’.-]*(?:${H}+${ORG_WORD}){0,4}${H}+(?:University|College|School|Academy|Bank|Credit Union|Foundation|Institute|Hospital|Clinic|Medical Center|Health|Laboratories|Labs|Trust|Association|Society|Council|Agency|Partners|Consulting|Solutions|Systems|Technologies|Mutual)(?![\\p{L}\\d])`, "gu");
const PLACE = new RegExp(`(?<![\\p{L}\\d])(?:${PLACE_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\d])`, "gu");
// "Knox County", "St. Tammany Parish", "Baltimore County"
const COUNTY = new RegExp(`(?<![\\p{L}\\d])(?!(?:The|This|That|Each|Every|Our|Your|Their|Its|A|Any|One)\\b)(?:St\\.${H}+)?\\p{Lu}[\\p{Ll}'’.-]+(?:${H}+\\p{Lu}[\\p{Ll}'’.-]+){0,2}${H}+(?:County|Parish|Borough)(?![\\p{L}\\d])`, "gu");
// Precise coordinates: 37.7749,-122.4194
const COORDINATES = /(?<![\d.])-?\d{1,2}\.\d{3,},\s*-?\d{1,3}\.\d{3,}(?![\d.])/g;

const LOCATION_CONTEXT =new RegExp(`\\b(?:lives? in|living in|based in|resides? in|resident of|moved to|moving to|relocat(?:e|es|ed|ing) (?:from|to)|home ?town is|born in|grew up in|staying in|bývam v|bývam na|bydlím v|žijem v|žiju v|wohne in|wohnt in|j'habite à|j'habite a|vivo en|vive en|abito a|mieszkam w)${H}+(${ANY_NAME})`, "dgu");
const OFFICE_LOCATION = new RegExp(`\\b(?:to|at|in) (?:our|the) (${CAP_WORD}(?:${H}${CAP_WORD})?) (?:office|site|branch|clinic|warehouse|plant|campus)`, "dgu");
const US_CITY_STATE = /\b(\p{Lu}\p{Ll}+(?:[^\S\r\n]\p{Lu}\p{Ll}+)?),[^\S\r\n]+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b(?![^\S\r\n]*\d)/dgu;

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectEntities(text) {
  const out = new Collector(text);
  collectPeople(text, out);
  collectOrganizations(text, out);
  collectLocations(text, out);
  return out.items;
}

/**
 * @param {string} text
 * @param {Collector} out
 */
function collectPeople(text, out) {
  for (const match of text.matchAll(TITLED)) {
    addName(out, match, 1, "high");
  }
  for (const match of text.matchAll(GREETING)) {
    addName(out, match, 1, "high");
  }
  for (const match of text.matchAll(SIGN_OFF)) {
    addName(out, match, 1, "high");
  }
  for (const match of text.matchAll(INTRODUCTION)) {
    addName(out, match, 1, "high");
  }
  for (const match of text.matchAll(WEAK_INTRODUCTION)) {
    if (FIRST_NAMES.has(normaliseName(match[1].split(/\s+/)[0]))) {
      addName(out, match, 1, "high");
    }
  }
  for (const match of text.matchAll(RELATION)) {
    addName(out, match, 1, "medium");
  }

  // "Attendees: Chiara Bianchi, Mateusz Wiśniewski and Aoife Byrne"
  for (const match of text.matchAll(LABEL)) {
    const indices = /** @type {any} */ (match).indices[1];
    let offset = indices[0];
    for (const part of match[1].split(/(,|;|\band\b|\s[-–—(<]\s?|<)/)) {
      const name = new RegExp(`^${H}*(${ANY_NAME})${H}*$`, "u").exec(part);
      if (name && !NOT_NAME.has(normaliseName(name[1].split(/\s+/)[0]))) {
        const start = offset + part.indexOf(name[1]);
        out.add(start, start + name[1].length, "PERSON", "people", "high");
      }
      offset += part.length;
    }
  }

  for (const match of text.matchAll(SELF_IDENTIFICATION)) {
    addName(out, match, 1, "high");
  }

  for (const match of text.matchAll(DICTIONARY_NAME)) {
    addDictionaryName(out, match);
  }

  // A first name on its own ("contact Emily at ..."): only next to other
  // personal data, and never a name that is also a word ("Will", "Grace").
  for (const match of text.matchAll(CAPITALISED_WORD)) {
    const name = normaliseName(match[0]);
    if (isFirstName(name) && !NAME_WORDS.has(name) && !NOT_NAME.has(name) && !PLACE_WORDS.has(name)) {
      const index = /** @type {number} */ (match.index);
      out.add(index, index + match[0].length, "PERSON", "people", "low", true);
    }
  }
}

/** @param {string} name Normalised. */
function isFirstName(name) {
  return FIRST_NAMES.has(name) || COMMON_FIRST_NAMES.has(name);
}

/**
 * Capitalised words that are a known first name and a surname ("Annabelle
 * Creighton", "Jeremy J. Smith"), or an unknown first name and a known
 * surname ("Zaitra Sarma").
 * @param {Collector} out
 * @param {RegExpMatchArray} match
 */
function addDictionaryName(out, match) {
  const words = match[1].split(/\s+/);
  const offsetOf = (/** @type {number} */ word) => /** @type {number} */ (match.index) + words.slice(0, word).reduce((sum, w) => sum + w.length + 1, 0);
  const end = /** @type {number} */ (match.index) + match[1].length;

  let first = 0;
  while (first < words.length - 1 && !isFirstName(normaliseName(words[first]))) {
    first += 1;
  }
  if (first < words.length - 1) {
    // The surname: the next word that is not a middle initial.
    const surnameWord = words.slice(first + 1).find((word) => !/^\p{Lu}\.$/u.test(word)) || "";
    const firstName = normaliseName(words[first]);
    const surname = normaliseName(surnameWord);
    if (!surname || NOT_NAME.has(surname)) {
      return;
    }
    const curated = FIRST_NAMES.has(firstName);
    // First names only in the large list ("Harvard", "Lionel") need a known
    // surname after them: "Harvard University" and "Lionel Messi" are not
    // private people's names.
    if (!curated && !SURNAMES.has(surname)) {
      return;
    }
    // Names found only through the large lists count next to other personal
    // data, like place names: "Donald Robinson, SSN ..." is redacted, "in
    // the style of Warren Buffett" is not. So does a curated first name that
    // is also a word before a word that is no surname ("Grace Period").
    const confident = curated && !(NAME_WORDS.has(firstName) && !SURNAMES.has(surname));
    out.add(offsetOf(first), end, "PERSON", "people", confident ? "medium" : "low", !confident);
    return;
  }

  // No known first name: a capitalised word before a known surname that is
  // not an ordinary word, next to other personal data.
  for (let i = 1; i < words.length; i += 1) {
    const surname = normaliseName(words[i]);
    const given = normaliseName(words[i - 1]);
    if (SURNAMES.has(surname) && !NAME_WORDS.has(surname) && !NAME_WORDS.has(given) && !NOT_NAME.has(given) && !PLACE_WORDS.has(given)) {
      out.add(offsetOf(i - 1), offsetOf(i) + words[i].length, "PERSON", "people", "low", true);
      return;
    }
  }
}

/**
 * @param {Collector} out
 * @param {RegExpMatchArray} match
 * @param {number} group
 * @param {import("./util.js").Confidence} confidence
 */
function addName(out, match, group, confidence) {
  const name = match[group];
  const words = name.split(/\s+/);
  // Trim leading and trailing words that cannot be part of a name.
  let first = 0;
  let last = words.length;
  while (first < last && NOT_NAME.has(normaliseName(words[first]))) {
    first += 1;
  }
  while (last > first && NOT_NAME.has(normaliseName(words[last - 1]))) {
    last -= 1;
  }
  if (first === last) {
    return;
  }
  const indices = /** @type {any} */ (match).indices[group];
  const start = indices[0] + words.slice(0, first).reduce((sum, word) => sum + word.length + 1, 0);
  const kept = words.slice(first, last).join(" ");
  out.add(start, start + kept.length, "PERSON", "people", confidence);
}

/**
 * @param {string} text
 * @param {Collector} out
 */
function collectOrganizations(text, out) {
  for (const match of text.matchAll(ORGANIZATION)) {
    const index = /** @type {number} */ (match.index);
    const weakSuffix = /(?:Group|Holdings)$/.test(match[0]);
    if (weakSuffix && isGenericPhrase(match[0])) {
      continue;
    }
    out.add(index, index + match[0].length, "ORG", "organizations", weakSuffix ? "medium" : "high");
  }
  for (const match of text.matchAll(ORG_CONTEXT)) {
    out.addGroup(match, 1, "ORG", "organizations", "medium");
  }
  for (const match of text.matchAll(INSTITUTION)) {
    const index = /** @type {number} */ (match.index);
    if (isGenericPhrase(match[0])) {
      continue;
    }
    out.add(index, index + match[0].length, "ORG", "organizations", "low", true);
  }
}

// Descriptive words that, with a suffix like "Health", "Systems" or
// "Group", name a topic or heading rather than a company: "Access Control
// Systems", "Travel Health", "Packing Group", "Current Holdings".
const GENERIC_ORG_WORDS = new Set([
  "access", "affected", "age", "behavioral", "behavioural", "blood", "child", "community", "comprehensive", "computer",
  "control", "current", "data", "digital", "environmental", "ethnic", "family", "focus", "global", "information",
  "management", "mental", "monitoring", "occupational", "operating", "oral", "packing", "personal", "population",
  "primary", "public", "risk", "security", "support", "target", "travel", "user", "working", "work", "study", "test",
  "sample", "income", "product", "customer", "employee", "patient", "member", "reproductive", "sexual", "women's",
  "men's", "maternal", "financial", "home", "school", "student", "project"
]);

/**
 * Whether every word before the final suffix word is a descriptive word.
 * @param {string} phrase
 */
function isGenericPhrase(phrase) {
  const words = phrase.split(/\s+/).slice(0, -1).map((word) => word.toLowerCase());
  return words.length > 0 && words.every((word) => GENERIC_ORG_WORDS.has(word) || word === "and" || word === "&" || word === "of");
}

/**
 * @param {string} text
 * @param {Collector} out
 */
function collectLocations(text, out) {
  for (const match of text.matchAll(LOCATION_CONTEXT)) {
    addPlace(out, match, 1);
  }
  for (const match of text.matchAll(OFFICE_LOCATION)) {
    addPlace(out, match, 1);
  }
  for (const match of text.matchAll(US_CITY_STATE)) {
    addPlace(out, match, 1);
  }
  for (const match of text.matchAll(PLACE)) {
    const index = /** @type {number} */ (match.index);
    out.add(index, index + match[0].length, "LOCATION", "locations", "low", true);
  }
  for (const match of text.matchAll(COUNTY)) {
    const index = /** @type {number} */ (match.index);
    out.add(index, index + match[0].length, "LOCATION", "locations", "low", true);
  }
  for (const match of text.matchAll(COORDINATES)) {
    const index = /** @type {number} */ (match.index);
    out.add(index, index + match[0].length, "COORDINATES", "locations", "high");
  }
}

/**
 * @param {Collector} out
 * @param {RegExpMatchArray} match
 * @param {number} group
 */
function addPlace(out, match, group) {
  const words = match[group].split(/\s+/);
  if (NOT_NAME.has(normaliseName(words[0]))) {
    return;
  }
  out.addGroup(match, group, "LOCATION", "locations", "medium");
}
