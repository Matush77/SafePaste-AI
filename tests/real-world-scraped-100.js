const assert = require("node:assert/strict");

global.window = global;
require("../src/redactor.js");

const settings = global.SensitivePasteRedactor.mergeSettings({
  categories: {
    urls: true
  }
});

const SOURCES = [
  "https://www.mit.edu/contact",
  "https://isn.mit.edu/contact-isn",
  "https://www.lamar.edu/admissions/how-to-apply/international/contact.html",
  "https://www.ndsu.edu/international/about/contact_us",
  "https://www.paloalto.gov/About/Contact-Us",
  "https://global.iu.edu/about/contact/index.html",
  "https://www.uow.edu.au/about/contacts/",
  "https://www.propublica.org/contact",
  "https://www.northwestu.edu/international/contact",
  "https://www.cityofmadison.com/contact",
  "https://www.who.int/about/contact-us",
  "https://www.sfu.ca/contact.html"
];

const PATTERNS = [
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ["phone", /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g],
  ["international_phone", /\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,6}\b/g],
  ["po_box", /\bP\.?O\.?\s*Box\s+\d{2,10}\b/gi],
  [
    "city_state_zip",
    /\b[A-Z][A-Za-z .'-]+,\s*(?:A[LKZR]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|P[ARW]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\s+\d{5}(?:-\d{4})?\b/g
  ],
  [
    "street_address",
    /\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z0-9][A-Za-z0-9.'-]*){0,7}\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Way|Place|Pl\.?|Mall|Square|Parkway|Pkwy\.?|Circle|Ct\.?|Court|Walk)\b(?:,?\s*(?:Suite|Ste\.?|Room|Rm\.?|Floor|Fl\.?|Building|Bldg\.?|Unit|#)\s*[A-Za-z0-9-]+)?/gi
  ]
];

function decodeHtml(text) {
  return text
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, "-")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function isUsableCandidate(value) {
  if (value.length < 5 || value.length > 100) {
    return false;
  }
  if (/cookie|privacy|javascript|captcha|cloudflare/i.test(value)) {
    return false;
  }
  if (/^\d{3}$/.test(value) || /^\d{4}-\d{4}$/.test(value)) {
    return false;
  }
  return true;
}

async function collectCandidates() {
  const candidates = [];
  const seen = new Set();
  const sourceResults = [];

  for (const url of SOURCES) {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 SafePasteAI-RedactionBenchmark"
      }
    });

    sourceResults.push({ url, status: response.status });
    if (!response.ok) {
      continue;
    }

    const text = htmlToText(await response.text());
    for (const [type, regex] of PATTERNS) {
      for (const match of text.matchAll(regex)) {
        const value = decodeHtml(match[0]).replace(/[.,;:]+$/, "");
        if (!isUsableCandidate(value)) {
          continue;
        }

        const key = value.toLowerCase();
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        candidates.push({ type, value, url });
      }
    }
  }

  return { candidates, sourceResults };
}

function testCandidates(candidates) {
  const tested = candidates.slice(0, 120);
  const failures = [];
  const typeCounts = {};

  for (const candidate of tested) {
    typeCounts[candidate.type] = (typeCounts[candidate.type] || 0) + 1;

    const result = global.SensitivePasteRedactor.redact(`Value: ${candidate.value}`, settings);
    if (result.text.includes(candidate.value)) {
      failures.push({
        ...candidate,
        output: result.text
      });
    }
  }

  return { tested, failures, typeCounts };
}

(async () => {
  const { candidates, sourceResults } = await collectCandidates();
  assert.ok(candidates.length >= 100, `Expected at least 100 candidates, found ${candidates.length}`);

  const { tested, failures, typeCounts } = testCandidates(candidates);
  const redacted = tested.length - failures.length;
  const percent = ((redacted / tested.length) * 100).toFixed(1);

  console.log("Fresh scraped public-contact benchmark");
  console.log(`Sources fetched: ${sourceResults.filter((source) => source.status >= 200 && source.status < 300).length}/${SOURCES.length}`);
  console.log(`Candidates collected: ${candidates.length}`);
  console.log(`Candidates tested: ${tested.length}`);
  console.log(`Sensitive values redacted: ${redacted}/${tested.length} (${percent}%)`);
  console.log(`Type mix: ${JSON.stringify(typeCounts)}`);

  if (failures.length) {
    console.log("Misses:");
    for (const failure of failures) {
      console.log(`- ${failure.type}: ${failure.value} @ ${failure.url}`);
    }
  }

  assert.equal(failures.length, 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
