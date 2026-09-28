// Street addresses, PO boxes and city + postcode lines.

import { Collector, before } from "./util.js";

const H = "[^\\S\\r\\n]"; // horizontal whitespace
// Word lengths are capped so a long unbroken run of letters cannot make the
// patterns backtrack quadratically (a paste must never freeze the page).
const WORD = "\\p{Lu}[\\p{L}'’.-]{0,30}";
const LOWER = "[\\p{Ll}]{1,30}";
// Patterns that begin with a word only start at the beginning of one.
const START = "(?<![\\p{L}\\p{N}'’.-])";
const PARTICLE = "(?:de|del|de la|da|das|do|dos|des|di|du|della|la|le|van|von|der|den|the|of)";

const STREET_SUFFIX = "(?:Street|St\\.?|Avenue|Ave\\.?|Road|Rd\\.?|Boulevard|Blvd\\.?|Lane|Ln\\.?|Drive|Dr\\.?|Court|Ct\\.?|Way|Place|Pl\\.?|Terrace|Close|Crescent|Cres\\.?|Square|Sq\\.?|Parkway|Pkwy\\.?|Circle|Cir\\.?|Highway|Hwy\\.?|Row|Walk|Mall|Plaza|Trail|Alley|Loop|Gardens|Grove|Mews)";
// Lowercase text only counts with an unambiguous street word.
const STREET_SUFFIX_LOWER = "(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|terrace|parkway|pkwy|highway|hwy)";
const UNIT = `(?:,?${H}*(?:Apt|Apartment|Suite|Ste|Unit|Flat|Floor|Fl|Room|Rm|Bldg|Building)\\.?${H}*#?[A-Za-z0-9-]+|${H}+#[A-Za-z0-9-]+)`;
const DIRECTION = `(?:${H}+(?:N|S|E|W|NE|NW|SE|SW|N\\.E\\.|N\\.W\\.|S\\.E\\.|S\\.W\\.)\\b)`;
const EU_STREET_WORD = "(?:Calle|Carrer|Avenida|Av\\.|Avda\\.?|Rua|Rue|Via|Viale|Corso|Piazza|Piazzale|Largo|Boulevard|Bd\\.?|Chemin|Allée|Impasse|Quai|Place|Plac|ulica|ul\\.|Ulica|náměstí|námestie|nám\\.|třída|trieda|utca|út|tér|Straße|Strasse|Platz)";
const EU_COMPOUND_SUFFIX = "(?:straße|strasse|str\\.|weg|gasse|allee|platz|ring|damm|ufer|chaussee|straat|gracht|laan|plein|kade|vej|gade|gatan|gata|vägen|veien|gate|utca|ulice|ulica|ova|ská|ého)";

/** @type {[RegExp, import("./util.js").Confidence][]} */
const PATTERNS = [
  // 742 Evergreen Terrace, 906 W 2ND AVE STE 100, 88 Birchwood Lane, Apt 4C
  [new RegExp(`(?<![\\w-])\\d{1,6}[A-Za-z]?${H}+(?:(?:N|S|E|W|NE|NW|SE|SW)\\.?${H}+)?(?:(?:${WORD}|\\d+(?:st|nd|rd|th))${H}+){1,5}${STREET_SUFFIX}(?![\\w])${DIRECTION}?${UNIT}?`, "gu"), "high"],
  [new RegExp(`(?<![\\w-])\\d{1,6}[A-Z]?${H}+(?:[NSEW]\\.?${H}+)?(?:[A-Z0-9][A-Z0-9'.-]*${H}+){1,5}(?:STREET|ST|AVENUE|AVE|ROAD|RD|BOULEVARD|BLVD|LANE|LN|DRIVE|DR|COURT|CT|WAY|PLACE|PL|TERRACE|PARKWAY|PKWY)\\.?(?![\\w])${DIRECTION}?${UNIT}?`, "g"), "high"],
  // 2231 w division st, 55 bedford ave apt 3r
  [new RegExp(`(?<![\\w-])\\d{1,6}${H}+(?:[nsew]\\.?${H}+)?(?:[a-z][a-z'.-]{0,30}${H}+){1,3}${STREET_SUFFIX_LOWER}\\.?(?![\\w])(?:,?${H}*(?:apt|suite|unit|ste|#)\\.?${H}*[a-z0-9-]+)?`, "g"), "medium"],
  // Flat 3, 27 Wellington Road
  [new RegExp(`\\b(?:Flat|Apartment|Apt|Unit|Suite)${H}+[A-Za-z0-9-]+,${H}*\\d{1,6}[A-Za-z]?${H}+(?:${WORD}${H}+){0,4}${STREET_SUFFIX}(?![\\w])`, "gu"), "high"],
  // Calle de Alcalá 42, Rua da Prata 118, Via Garibaldi 21, ul. Długa 5
  [new RegExp(`\\b${EU_STREET_WORD}${H}+(?:(?:${PARTICLE}|${WORD})${H}+){0,4}${WORD},?${H}+\\d{1,5}[A-Za-z]?(?:[/-]\\d{1,4}[A-Za-z]?)?(?!\\d)`, "gu"), "high"],
  // 14 rue des Lilas, 24 Rue de Rivoli, 1000 Avenida Paulista
  [new RegExp(`(?<![\\w-])\\d{1,5}[A-Za-z]?,?${H}+${EU_STREET_WORD}${H}+(?:(?:${PARTICLE}|${WORD})${H}+){0,3}${WORD}`, "giu"), "high"],
  // Kastanienallee 45, Musterstrasse 12, Keizersgracht 123
  [new RegExp(`${START}\\p{Lu}${LOWER}${EU_COMPOUND_SUFFIX}${H}+\\d{1,5}[A-Za-z]?(?:[/-]\\d{1,4})?(?!\\d)`, "gu"), "high"],
  // 1-1 Chiyoda, 2-14-3 Nagatacho
  [new RegExp(`(?<![\\w.-])\\d{1,4}-\\d{1,4}(?:-\\d{1,4})?${H}+\\p{Lu}${LOWER}(?:(?:-|${H})\\p{Lu}?${LOWER}){0,2}\\b`, "gu"), "medium"],
  // PO Box 1297
  [/\b(?:P\.?\s?O\.?\s*Box|Post Office Box|Postfach|Apartado|Casella Postale|BP)\s+\d{1,7}\b/gi, "high"],
  // Springfield, IL 62704 / Washington, D.C. 20201
  [new RegExp(`${START}(?:${WORD}${H}+){0,3}${WORD},?${H}*(?:D\\.C\\.|AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)${H}+\\d{5}(?:-\\d{4})?\\b`, "gu"), "high"],
  // UK postcode, optionally after the town: Leeds LS3 1BQ, London SW1A 2AA
  [new RegExp(`(?:${START}(?:${WORD}${H}+){1,2})?\\b(?:GIR${H}?0AA|[A-PR-UWYZ](?:\\d[A-HJKPSTUW]?|[A-HK-Y]\\d[ABEHMNPRV-Y]?|\\d{2}|[A-HK-Y]\\d{2})${H}?\\d[ABD-HJLNP-UW-Z]{2})\\b`, "gu"), "high"],
  // Canada: Toronto, ON M5V 2T6
  [new RegExp(`${START}(?:${WORD}${H}+){0,2}${WORD},?${H}*(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)${H}+[A-Z]\\d[A-Z]${H}?\\d[A-Z]\\d\\b`, "gu"), "high"],
  // Australia: Sydney NSW 2000
  [new RegExp(`${START}${WORD}(?:${H}+${WORD}){0,2}${H}+(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)${H}+\\d{4}\\b`, "gu"), "high"],
  // Japan: Tokyo 100-8111
  [new RegExp(`${START}${WORD}(?:-ku|-shi)?,?${H}+(?:${WORD}${H}+)?\\d{3}-\\d{4}\\b`, "gu"), "medium"],
  // Ireland: Dublin 2, D02 X285 (Eircode)
  [new RegExp(`\\bDublin${H}\\d{1,2}W?\\b`, "g"), "high"],
  [/\b[AC-FHKNPRTV-Y]\d{2}[^\S\r\n]?[AC-FHKNPRTV-Y0-9]{4}\b(?=\s*(?:$|[,.;\n]))/g, "medium"],
  // Brazil: SP 01310-100
  [new RegExp(`\\b[A-Z]{2}${H}+\\d{5}-\\d{3}\\b`, "g"), "medium"]
];

// Postcode then town, at the start of a line or after a comma:
// "10435 Berlin", "75004 Paris", "1100-418 Lisboa", "811 01 Bratislava".
const POSTCODE_TOWN = new RegExp(`(?:^|(?<=,${H}*)|(?<=\\n${H}*))(\\d{4}${H}?[A-Z]{2}|\\d{4,5}|\\d{4}-\\d{3}|\\d{3}${H}\\d{2}|\\d{2}-\\d{3})${H}+(\\p{Lu}[\\p{Ll}'’-]{1,30}(?:(?:-|${H})\\p{Lu}[\\p{Ll}'’-]{1,30}){0,2})(?=$|[,.;)\\n]|${H}*$)`, "gmu");
// Town then postcode: "Bengaluru 560001", "Berlin 10115" when on an address line.
const TOWN_POSTCODE = new RegExp(`(?:^|(?<=,${H}*))(\\p{Lu}[\\p{Ll}'’-]{1,30}(?:${H}\\p{Lu}[\\p{Ll}'’-]{1,30}){0,2})${H}+(\\d{5,6})(?=$|[,.;)\\n])`, "gmu");

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectAddresses(text) {
  const out = new Collector(text);

  for (const [regex, confidence] of PATTERNS) {
    for (const match of text.matchAll(regex)) {
      const index = /** @type {number} */ (match.index);
      if (/^\d{4}\s/.test(match[0]) && isLikelyYear(match[0])) {
        continue;
      }
      out.add(index, index + match[0].length, "ADDRESS", "addresses", confidence);
    }
  }

  for (const regex of [POSTCODE_TOWN, TOWN_POSTCODE]) {
    for (const match of text.matchAll(regex)) {
      const index = /** @type {number} */ (match.index);
      const code = regex === POSTCODE_TOWN ? match[1] : match[2];
      if (/^(?:19|20)\d{2}$/.test(code) || /\b(?:order|invoice|version|v|build|ticket|id|no\.?|#|total|page|room)\s*$/i.test(before(text, index, 12))) {
        continue;
      }
      out.add(index, index + match[0].length, "ADDRESS", "addresses", "medium");
    }
  }

  return extendWithTrailingTown(text, out.items);
}

// ", Bengaluru", ", United States": a capitalised town, region or country
// segment after an address.
const TRAILING_PLACE = /^,[^\S\r\n]*\p{Lu}[\p{L}'’.-]*(?:[^\S\r\n]\p{Lu}[\p{L}'’.-]*){0,2}(?=[^\S\r\n]*(?:[,.;)]|$|\n))/u;
// ", chicago" at the end of a line in lower-case chat.
const TRAILING_LOWER_TOWN = /^,[^\S\r\n]*[\p{Ll}][\p{L}'’.-]*(?:[^\S\r\n][\p{Ll}][\p{L}'’.-]*)?[^\S\r\n]*(?=$|\n)/u;

/**
 * Pulls trailing town/region/country segments on the same line into the
 * address, so they do not sit exposed next to the redacted street.
 * @param {string} text
 * @param {import("./util.js").Candidate[]} items
 */
function extendWithTrailingTown(text, items) {
  for (const item of items) {
    for (let segment = 0; segment < 3; segment += 1) {
      const rest = text.slice(item.end, item.end + 60);
      const tail = TRAILING_PLACE.exec(rest) || TRAILING_LOWER_TOWN.exec(rest);
      if (!tail) {
        break;
      }
      item.end += tail[0].trimEnd().length;
    }
  }
  return items;
}

/** @param {string} value */
function isLikelyYear(value) {
  return /^(?:19|20)\d{2}\s/.test(value);
}
