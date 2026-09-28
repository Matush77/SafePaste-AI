(function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    enabled: true,
    showToast: true,
    placeholderStyle: "typed",
    categories: {
      apiKeys: true,
      credentials: true,
      emails: true,
      phones: true,
      financial: true,
      governmentIds: true,
      network: true,
      addresses: true,
      people: true,
      organizations: true,
      locations: true,
      urls: false
    }
  };

  const CATEGORY_LABELS = {
    apiKeys: "API_KEY",
    credentials: "CREDENTIAL",
    emails: "EMAIL",
    phones: "PHONE",
    financial: "FINANCIAL",
    governmentIds: "GOV_ID",
    network: "NETWORK",
    addresses: "ADDRESS",
    people: "PERSON",
    organizations: "ORG",
    locations: "LOCATION",
    urls: "URL"
  };

  const COMMON_FIRST_NAMES = new Set([
    "Aaron", "Abigail", "Adam", "Aisha", "Alan", "Albert", "Alex", "Alexander", "Alice",
    "Alicia", "Amanda", "Amelia", "Amy", "Andrew", "Angela", "Anna", "Anthony", "Arjun",
    "Ashley", "Barbara", "Ben", "Benjamin", "Brian", "Brianna", "Carlos", "Carol",
    "Catherine", "Charles", "Charlotte", "Chris", "Christian", "Christine", "Christopher",
    "Daniel", "Danielle", "David", "Diana", "Elizabeth", "Emily", "Emma", "Eric", "Ethan",
    "Fatima", "Francis", "George", "Grace", "Hannah", "Henry", "Isabella", "Jack", "Jacob",
    "James", "Jasmine", "Jennifer", "Jessica", "John", "Jonathan", "Jose", "Joseph",
    "Joshua", "Julia", "Karen", "Katherine", "Kevin", "Laura", "Lauren", "Linda", "Lisa",
    "Maria", "Marie", "Mark", "Marta", "Martin", "Mary", "Matthew", "Michael", "Michelle",
    "Mohamed", "Muhammad", "Natalie", "Nicholas", "Nicole", "Olivia", "Patricia", "Paul",
    "Peter", "Priya", "Rachel", "Rebecca", "Robert", "Ryan", "Samantha", "Samuel", "Sarah",
    "Scott", "Sophia", "Stephen", "Steven", "Susan", "Thomas", "Victoria", "William", "Yuki",
    "Chloe", "Derek", "Elena", "Liam", "Maya", "Mia", "Noah", "Omar", "Ravi", "Zara",
    "Anika", "Dana", "Emilie", "Grace", "Helen", "Henry", "Joao", "Jose", "Kenji", "Klara",
    "Marco", "Mei", "Monica", "Niamh", "Noor", "Nora", "Oliver", "Petra", "Riley", "Victor"
  ]);

  const LOCATION_WORDS = new Set([
    "Amsterdam", "Austin", "Barcelona", "Berlin", "Boston", "Bratislava", "Brno", "Brussels",
    "Budapest", "California", "Chicago", "Copenhagen", "Dallas", "Denver", "Dublin", "Florida",
    "France", "Germany", "India", "Ireland", "London", "Madrid", "Massachusetts", "Miami",
    "Milan", "Munich", "New York", "Paris", "Poland", "Prague", "Seattle", "Spain", "Texas",
    "Tokyo", "Toronto", "United Kingdom", "United States", "Vienna", "Warsaw", "Washington",
    "Lisbon", "Melbourne", "Singapore", "Zurich", "Japan", "San Francisco"
  ]);

  const CAPITALIZED_STOPWORDS = new Set([
    "A", "An", "And", "As", "At", "By", "For", "From", "I", "If", "In", "Into", "It", "Its",
    "Of", "On", "Or", "Our", "The", "This", "To", "We", "When", "Where", "With", "You"
  ]);

  const PERSON_PREFIX_WORDS = new Set([
    "Account", "Applicant", "Client", "Contact", "Customer", "Employee", "Manager", "Owner",
    "Patient", "Recipient", "Representative", "Requester", "Sender", "Signer", "Traveler", "User", "Vendor"
  ]);

  const DETECTORS = [
    {
      category: "apiKeys",
      label: "OPENAI_API_KEY",
      regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g
    },
    {
      category: "apiKeys",
      label: "AWS_ACCESS_KEY",
      regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
    },
    {
      category: "apiKeys",
      label: "GITHUB_TOKEN",
      regex: /\bgh[pousr]_[A-Za-z0-9_]{30,255}\b/g
    },
    {
      category: "apiKeys",
      label: "GITHUB_TOKEN",
      regex: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g
    },
    {
      category: "apiKeys",
      label: "SLACK_TOKEN",
      regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g
    },
    {
      category: "apiKeys",
      label: "SLACK_WEBHOOK",
      regex: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}\b/g
    },
    {
      category: "apiKeys",
      label: "GOOGLE_API_KEY",
      regex: /\bAIza[0-9A-Za-z_-]{35}\b/g
    },
    {
      category: "apiKeys",
      label: "STRIPE_SECRET_KEY",
      regex: /\bsk_(?:live|test)_[0-9A-Za-z]{24,}\b/g
    },
    {
      category: "apiKeys",
      label: "JWT",
      regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
    },
    {
      category: "apiKeys",
      label: "BEARER_TOKEN",
      regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g
    },
    {
      category: "apiKeys",
      label: "AWS_SECRET_ACCESS_KEY",
      regex: /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*([A-Za-z0-9/+=]{40})\b/g,
      valueGroup: 1
    },
    {
      category: "apiKeys",
      label: "PRIVATE_KEY",
      regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
    },
    {
      category: "credentials",
      label: "SECRET",
      regex: /\b(?:password|passwd|pwd|secret|client_secret|webhook_secret|token|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["']?([^\s"',;]{6,})["']?/gi,
      valueGroup: 1
    },
    {
      category: "credentials",
      label: "SECRET",
      regex: /\b[A-Za-z0-9_-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["']?([^\s"',;]{6,})["']?/gi,
      valueGroup: 1
    },
    {
      category: "credentials",
      label: "SECRET",
      regex: /\b(?:password|passphrase|secret)\s+is\s+["']([^"']{6,})["']/gi,
      valueGroup: 1
    },
    {
      category: "credentials",
      label: "SECRET",
      regex: /\b(?:invitation code|invite code|access code|recovery code)\s*[:=]?\s*["']?([A-Za-z0-9][A-Za-z0-9_-]{5,})["']?/gi,
      valueGroup: 1
    },
    {
      category: "credentials",
      label: "SECRET_URL",
      regex: /\bhttps?:\/\/[^\s<>"']*(?:token|signature|credential|auth|secret|code|key)[^\s<>"']*/gi
    },
    {
      category: "emails",
      label: "EMAIL",
      regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
    },
    {
      category: "phones",
      label: "PHONE",
      regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g
    },
    {
      category: "phones",
      label: "PHONE",
      regex: /\+\d{1,3}(?:[^\S\r\n]?\(?\d{1,4}\)?){2,6}\b/g
    },
    {
      category: "phones",
      label: "PHONE_EXT",
      regex: /\b(?:ext\.?|extension|x)\s*\d{2,6}\b/gi
    },
    {
      category: "governmentIds",
      label: "SSN",
      regex: /\b\d{3}-\d{2}-\d{4}\b/g
    },
    {
      category: "governmentIds",
      label: "SSN",
      regex: /\b\d{3}\s+\d{2}\s+\d{4}\b/g
    },
    {
      category: "governmentIds",
      label: "TAX_ID",
      regex: /\b(?:EIN(?:\/tax ID)?(?: number)?|Tax ID(?: number)?|TIN)\s*[:#]?\s*\d{2}-\d{7}\b/gi
    },
    {
      category: "governmentIds",
      label: "TAX_ID",
      regex: /\b\d{2}-\d{7}\b/g
    },
    {
      category: "governmentIds",
      label: "PASSPORT",
      regex: /\b(?:passport(?: number)?|passport no\.?)\s*[:#]?\s*[A-Z][0-9]{7,8}\b/gi
    },
    {
      category: "governmentIds",
      label: "DRIVER_LICENSE",
      regex: /\b(?:driver(?:'s)? license|driving licence|DL)\s*[:#]?\s*[A-Z][0-9]{7,12}\b/gi
    },
    {
      category: "governmentIds",
      label: "DOB",
      regex: /\b(?:DOB|date of birth)\s*[:#]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi
    },
    {
      category: "governmentIds",
      label: "ID",
      regex: /\b(?:MRN|Patient ID|EID|Employee ID|vehicle plate|plate)\s*[:#]?\s*[A-Z0-9-]{5,14}\b/gi
    },
    {
      category: "financial",
      label: "IBAN",
      regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g
    },
    {
      category: "financial",
      label: "IBAN",
      regex: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/g
    },
    {
      category: "financial",
      label: "BANK_ACCOUNT",
      regex: /\b(?:account(?: number)?|acct)\s*[:#]?\s*\d{8,17}\b/gi
    },
    {
      category: "financial",
      label: "ROUTING_NUMBER",
      regex: /\b(?:routing(?: number)?|ABA)\s*[:#]?\s*\d{9}\b/gi
    },
    {
      category: "financial",
      label: "SWIFT_BIC",
      regex: /\b(?:SWIFT|BIC)\s*[:#]?\s*[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi
    },
    {
      category: "network",
      label: "IP_ADDRESS",
      regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g
    },
    {
      category: "network",
      label: "IPV6_ADDRESS",
      regex: /\b(?![0-9A-F]{2}(?::[0-9A-F]{2}){5}\b)(?=[0-9A-F:]*[0-9A-F]{3,4})(?:[0-9A-F]{1,4}:){2,7}[0-9A-F]{1,4}\b/gi
    },
    {
      category: "locations",
      label: "COORDINATES",
      regex: /\b-?\d{1,3}\.\d{3,},\s*-?\d{1,3}\.\d{3,}\b/g
    },
    {
      category: "network",
      label: "MAC_ADDRESS",
      regex: /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b\d{1,6}[^\S\r\n]+(?:[A-Z][a-z0-9'.-]+[^\S\r\n]+){1,5}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Way|Place|Pl\.?)(?=[^\w]|$)(?:[^\S\r\n]+(?:NE|NW|SE|SW|N|S|E|W)|,?[^\S\r\n]+(?:NE|NW|SE|SW|N\.E\.|N\.W\.|S\.E\.|S\.W\.))?(?:,?[^\S\r\n]*(?:Apt|Suite|Ste|Unit)\.?[^\S\r\n]*#?[A-Z0-9-]+|[^\S\r\n]+#[A-Z0-9-]+)?/g
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b\d{1,6}[^\S\r\n]+(?:[A-Z][A-Za-z0-9'.-]*[^\S\r\n]+){0,5}(?:Mall|Plaza|Parkway|Pkwy\.?|Circle|Cir\.?|Loop|Row|Walk|Campus|Center|Centre)\b/g
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b\d{1,6}[A-Z]?[^\S\r\n]+(?:[A-Z][A-Za-z0-9'.-]*|de|del|of|the|la|le|du|da|di)[^\S\r\n]+(?:[A-Z][A-Za-z0-9'.-]*[^\S\r\n]+){0,4}(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Ln\.?|Drive|Dr\.?|Square|Terrace|Road|Gracht|Strasse|Straße)\b/gi
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b\d{1,6}[^\S\r\n]+(?:[NSEW]\.?[^\S\r\n]+)?(?:[A-Z0-9][A-Z0-9'.-]*[^\S\r\n]+){1,6}(?:STREET|ST\.?|AVENUE|AVE\.?|ROAD|RD\.?|BOULEVARD|BLVD\.?|LANE|LN\.?|DRIVE|DR\.?|COURT|CT\.?|WAY|PLACE|PL\.?)(?=[^\w]|$)(?:[^\S\r\n]+(?:NE|NW|SE|SW|N|S|E|W)|,?[^\S\r\n]+(?:NE|NW|SE|SW|N\.E\.|N\.W\.|S\.E\.|S\.W\.))?(?:,?[^\S\r\n]*(?:APT|SUITE|STE|UNIT)\.?[^\S\r\n]*#?[A-Z0-9-]+|[^\S\r\n]+#[A-Z0-9-]+)?/gi
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b(?:P\.?O\.?\s*Box|PO Box|Post Office Box)\s+\d+[A-Z-]?\b/gi
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b(?:Unit|Suite|Ste\.?|Apt)\s+[A-Z0-9-]+,\s*\d{1,6}[A-Z]?[^\S\r\n]+(?:[A-Z][A-Za-z0-9'.-]*[^\S\r\n]+){0,4}(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Way|Place|Pl\.?)\b/gi
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b\d{1,4}-\d{1,4}[^\S\r\n]+[A-Z][A-Za-z'.-]+(?:[^\S\r\n]+[A-Z][A-Za-z'.-]+){0,3}\b/g
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b(?:Av\.?|Avenida|Rua|Rue)[^\S\r\n]+[A-Z][A-Za-z'.-]+(?:[^\S\r\n]+[A-Z][A-Za-z'.-]+){0,3},?[^\S\r\n]+\d{1,6}\b/gi
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b[A-Z][A-Za-z'.-]*(?:strasse|straat|gracht|gasse|allee|platz)[^\S\r\n]+\d{1,6}[A-Z]?\b/gi
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b[A-Z][A-Z .'-]+,[^\S\r\n]*(?:D\.?C\.?|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)[^\S\r\n]+\d{5}(?:-\d{4})?\b/gi
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b[A-Z][A-Za-z .'-]+,\s*(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\s+[A-Z]\d[A-Z][^\S\r\n]?\d[A-Z]\d\b/g
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b[A-Z][A-Za-z .'-]+\s+(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+\d{4}\b/g
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b[A-Z][A-Za-z .'-]+\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b(?:[A-Z][A-Za-z .'-]+,\s*)?[A-Z]{2}\s+\d{5}(?:-\d{3})?\b/g
    },
    {
      category: "addresses",
      label: "ADDRESS",
      regex: /\b(?:[A-Z][A-Za-z .'-]+\s+\d{5,6}|\d{4,6}\s+[A-Z][A-Za-z .'-]+)\b/g
    },
    {
      category: "organizations",
      label: "ORG",
      regex: /\b(?:[A-Z][A-Za-z0-9&'.-]*\s+){0,5}[A-Z][A-Za-z0-9&'.-]*\s+(?:Inc\.?|LLC|Ltd\.?|Limited|Corp\.?|Corporation|Company|GmbH|S\.A\.|University|Hospital|Bank|Foundation|Institute|Laboratories|Labs)(?=\s|[,.!?;:]|$)/g
    },
    {
      category: "locations",
      label: "LOCATION",
      regex: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/g
    },
    {
      category: "urls",
      label: "URL",
      regex: /\bhttps?:\/\/[^\s<>"']+/gi
    }
  ];

  function mergeSettings(settings) {
    return {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
      categories: {
        ...DEFAULT_SETTINGS.categories,
        ...((settings && settings.categories) || {})
      }
    };
  }

  function createPlaceholderFactory(settings) {
    const counters = new Map();
    const values = new Map();

    return function placeholderFor(type, value) {
      const key = `${type}\u0000${value}`;
      if (values.has(key)) {
        return values.get(key);
      }

      const count = (counters.get(type) || 0) + 1;
      counters.set(type, count);

      const placeholder = settings.placeholderStyle === "compact"
        ? `[${type}_${count}]`
        : `[[${type}_${count}]]`;
      values.set(key, placeholder);
      return placeholder;
    };
  }

  function isCategoryEnabled(settings, category) {
    return Boolean(settings.categories && settings.categories[category]);
  }

  function addMatch(matches, text, start, end, type, category) {
    if (start < 0 || end <= start) {
      return;
    }

    const value = text.slice(start, end);
    if (!value || /^\s+$/.test(value)) {
      return;
    }

    matches.push({ start, end, value, type, category });
  }

  function collectRegexMatches(text, settings) {
    const matches = [];

    for (const detector of DETECTORS) {
      if (!isCategoryEnabled(settings, detector.category)) {
        continue;
      }

      detector.regex.lastIndex = 0;
      let match;
      while ((match = detector.regex.exec(text)) !== null) {
        const raw = match[0];
        if (!raw) {
          continue;
        }

        let start = match.index;
        let end = start + raw.length;

        if (detector.valueGroup && match[detector.valueGroup]) {
          const offset = raw.indexOf(match[detector.valueGroup]);
          start += offset;
          end = start + match[detector.valueGroup].length;
        }

        addMatch(matches, text, start, end, detector.label, detector.category);
      }
    }

    if (isCategoryEnabled(settings, "financial")) {
      collectCreditCards(text, matches);
    }

    return matches;
  }

  function collectCreditCards(text, matches) {
    const regex = /\b(?:\d[ -]*?){13,19}\b/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const digits = match[0].replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
        addMatch(matches, text, match.index, match.index + match[0].length, "CREDIT_CARD", "financial");
      }
    }
  }

  function luhnValid(digits) {
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let n = Number(digits[i]);
      if (shouldDouble) {
        n *= 2;
        if (n > 9) {
          n -= 9;
        }
      }
      sum += n;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  function collectNerMatches(text, settings) {
    const matches = [];

    if (isCategoryEnabled(settings, "people")) {
      collectPeople(text, matches);
    }

    if (isCategoryEnabled(settings, "locations")) {
      collectKnownLocations(text, matches);
    }

    return matches;
  }

  function collectPeople(text, matches) {
    const titled = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
    let titledMatch;
    while ((titledMatch = titled.exec(text)) !== null) {
      addMatch(matches, text, titledMatch.index, titledMatch.index + titledMatch[0].length, "PERSON", "people");
    }

    const contextName = /\b(?:Call|Contact|Customer|Client|Patient|Traveler|Applicant|Owner|Employee|Manager|Recipient|Signer|signer|Driver|driver|Engineer|engineer|for|from)\s*[:,-]?\s+((?:Dr\.?\s+)?[A-Z][a-z]+(?:[-'][A-Za-z]+)?(?:\s+(?:de|del|van|von|da|di))?\s+(?:[A-Z][a-z]+|[A-Z]'[A-Za-z]+)(?:[-'][A-Za-z]+)?)/g;
    let contextMatch;
    while ((contextMatch = contextName.exec(text)) !== null) {
      const offset = contextMatch[0].indexOf(contextMatch[1]);
      addMatch(matches, text, contextMatch.index + offset, contextMatch.index + contextMatch[0].length, "PERSON", "people");
    }

    const particleName = /\b[A-Z][a-z]+(?:\s+(?:de|del|van|von|da|di))\s+[A-Z][A-Za-z]+(?:[-'][A-Za-z]+)?\b/g;
    let particleMatch;
    while ((particleMatch = particleName.exec(text)) !== null) {
      addMatch(matches, text, particleMatch.index, particleMatch.index + particleMatch[0].length, "PERSON", "people");
    }

    const fullName = /\b[A-Z][a-z]+(?:[-'][A-Za-z]+)?\s+(?:[A-Z][a-z]+|[A-Z]'[A-Za-z]+)(?:[-'][A-Za-z]+)?(?:\s+[A-Z][a-z]+(?:[-'][A-Za-z]+)?){0,2}\b/g;
    let match;
    while ((match = fullName.exec(text)) !== null) {
      const words = match[0].split(/\s+/);
      const first = words[0];
      if (PERSON_PREFIX_WORDS.has(first) && words.length >= 3 && COMMON_FIRST_NAMES.has(words[1])) {
        const offset = first.length + 1;
        addMatch(matches, text, match.index + offset, match.index + match[0].length, "PERSON", "people");
        continue;
      }
      if (CAPITALIZED_STOPWORDS.has(first)) {
        continue;
      }
      if (COMMON_FIRST_NAMES.has(first) || looksLikeSignatureContext(text, match.index)) {
        addMatch(matches, text, match.index, match.index + match[0].length, "PERSON", "people");
      }
    }
  }

  function looksLikeSignatureContext(text, index) {
    const prefix = text.slice(Math.max(0, index - 24), index).toLowerCase();
    return /(?:from|by|regards|thanks|thank you|signed|owner|customer|patient|employee)\s*[:,-]?\s*$/.test(prefix);
  }

  function collectKnownLocations(text, matches) {
    for (const location of LOCATION_WORDS) {
      const regex = new RegExp(`\\b${escapeRegExp(location)}\\b`, "g");
      let match;
      while ((match = regex.exec(text)) !== null) {
        addMatch(matches, text, match.index, match.index + location.length, "LOCATION", "locations");
      }
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function resolveOverlaps(matches) {
    return matches
      .sort((a, b) => {
        const lengthDiff = (b.end - b.start) - (a.end - a.start);
        return a.start - b.start || lengthDiff;
      })
      .reduce((accepted, candidate) => {
        const overlaps = accepted.some((match) => candidate.start < match.end && candidate.end > match.start);
        if (!overlaps) {
          accepted.push(candidate);
        }
        return accepted;
      }, [])
      .sort((a, b) => a.start - b.start);
  }

  function redact(text, settingsInput) {
    const settings = mergeSettings(settingsInput);
    if (!text || !settings.enabled) {
      return { text, changed: false, findings: [] };
    }

    const matches = resolveOverlaps([
      ...collectRegexMatches(text, settings),
      ...collectNerMatches(text, settings)
    ]);

    if (matches.length === 0) {
      return { text, changed: false, findings: [] };
    }

    const placeholderFor = createPlaceholderFactory(settings);
    let output = "";
    let cursor = 0;
    const findings = [];

    for (const match of matches) {
      output += text.slice(cursor, match.start);
      const label = match.type || CATEGORY_LABELS[match.category] || "REDACTED";
      const placeholder = placeholderFor(label, match.value);
      output += placeholder;
      cursor = match.end;
      findings.push({
        category: match.category,
        type: label,
        placeholder,
        length: match.value.length
      });
    }

    output += text.slice(cursor);

    return {
      text: output,
      changed: output !== text,
      findings
    };
  }

  window.SensitivePasteRedactor = {
    DEFAULT_SETTINGS,
    CATEGORY_LABELS,
    mergeSettings,
    redact
  };
})();
