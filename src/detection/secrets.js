// API keys, tokens, private keys and credentials.

import { Collector, before, isPlaceholder, looksRandom } from "./util.js";

/**
 * Well-known token formats. The whole token is always redacted, prefix
 * included, so no recognisable fragment is left behind.
 * @type {[string, RegExp][]}
 */
const TOKEN_FORMATS = [
  ["ANTHROPIC_API_KEY", /\bsk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{20,}/g],
  ["OPENAI_API_KEY", /\bsk-(?!ant-)(?:proj-|svcacct-|admin-|None-)?[A-Za-z0-9_-]{20,}/g],
  ["STRIPE_KEY", /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/g],
  ["STRIPE_WEBHOOK_SECRET", /\bwhsec_[A-Za-z0-9]{16,}/g],
  ["GITHUB_TOKEN", /\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  ["GITHUB_TOKEN", /\bgithub_pat_[A-Za-z0-9_]{40,}/g],
  ["GITLAB_TOKEN", /\bgl(?:pat|dt|rt|cbt|ptt|oas|ft|imt|agent)-[A-Za-z0-9_-]{20,}/g],
  ["NPM_TOKEN", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["PYPI_TOKEN", /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g],
  ["HUGGINGFACE_TOKEN", /\bhf_[A-Za-z0-9]{30,}/g],
  ["SLACK_TOKEN", /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g],
  ["SLACK_TOKEN", /\bxapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+/g],
  ["SLACK_WEBHOOK", /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{20,}/g],
  ["DISCORD_WEBHOOK", /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{30,}/g],
  ["AWS_ACCESS_KEY", /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g],
  ["GOOGLE_API_KEY", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["GOOGLE_OAUTH_TOKEN", /\bya29\.[0-9A-Za-z_-]{20,}/g],
  ["SENDGRID_API_KEY", /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g],
  ["DOCKER_TOKEN", /\bdckr_pat_[A-Za-z0-9_-]{20,}/g],
  ["SHOPIFY_TOKEN", /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}\b/g],
  ["DIGITALOCEAN_TOKEN", /\bdo[opr]_v1_[a-f0-9]{64}\b/g],
  ["GROQ_API_KEY", /\bgsk_[A-Za-z0-9]{40,}/g],
  ["XAI_API_KEY", /\bxai-[A-Za-z0-9]{40,}/g],
  ["TWILIO_KEY", /\bSK[a-f0-9]{32}\b/g],
  ["SQUARE_TOKEN", /\bsq0(?:atp|csp)-[A-Za-z0-9_-]{22,}/g],
  ["GRAFANA_TOKEN", /\bglsa_[A-Za-z0-9]{32}_[a-f0-9]{8}\b/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g]
];

// A key name that says its value is a secret. Matched against the last
// segment of the key, lower-cased, with separators normalised to "_".
const SECRET_KEY = /(?:^|_)(?:pass(?:word|wd|phrase|code)?|pwd|secret|token|api_?key|apikey|access_?key|secret_?key|private_?key|client_?secret|auth(?:_?token|_?key)?|credentials?|session(?:_?id|_?key)?|sessid|cookie|csrf(?:_?token)?|xsrf|signing_?key|encryption_?key|master_?key|account_?key|conn(?:ection)?_?str(?:ing)?|dsn|webhook_?secret|bearer|jwt)$/;
// Key names that describe a secret without holding one.
const NOT_A_SECRET_KEY = /(?:_|^)(?:url|uri|endpoint|type|types|length|len|min|max|expires?|expiry|expires_in|ttl|timeout|name|names|field|header|prompt|label|hint|policy|hash(?:er|ers)?|reset|required|enabled|file|path|env|mode|format|count|id)$/;
// A key ending in "key" is only a secret when its value looks random.
const WEAK_SECRET_KEY = /(?:^|_)key$/;

// key = value, key: value, key => value, "key": "value", with an optional
// quoted value. Group 1 is the key, group 2 a quoted value, group 3 an
// unquoted value.
const ASSIGNMENT = /(?<![\w.-])["']?([A-Za-z_][\w.-]*)["']?[ \t]*(?:=>|:=|=|:)[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'`,;{}()[\]<>]+[^\s"'`,;{}()<>]*))/dg;
// define('KEY', 'value') and similar key/value argument pairs.
const ARGUMENT_PAIR = /["']([A-Za-z_][\w.-]*)["']\s*,\s*(?:"([^"\n]*)"|'([^'\n]*)')/dg;

// Words that start an expression rather than a literal on the right-hand side.
const CODE_WORDS = /^(?:string|number|boolean|bool|int|integer|float|str|bytes|any|object|null|none|nil|undefined|true|false|new|await|function|lambda|self|this|required|optional|env|os|process|config|settings|request|req|params|props)$/i;

const PROSE_SECRET = /\b(?:password|passcode|passphrase|pass phrase|pin(?: code)?|wi-?fi password|code)\b(?: for [\w .'-]{1,30}?)?\s+(?:is|was)\s+(?:"([^"\n]{4,})"|'([^'\n]{4,})'|([^\s"']{4,}))/dgi;
const CONTEXT_CODES = /\b(?:recovery|backup|verification|invitation|invite|access|one-time|2fa|mfa|booking|reservation|confirmation)\s+(?:codes?|reference|ref\.?|number)\b[^\n]{0,20}?[:\s]\s*/gi;
const CODE_TOKEN = /\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]{3,8}(?:-[A-Za-z0-9]{3,8}){0,3}\b/g;

/**
 * @param {string} text
 * @returns {import("./util.js").Candidate[]}
 */
export function detectSecrets(text) {
  const out = new Collector(text);

  for (const [type, regex] of TOKEN_FORMATS) {
    for (const match of text.matchAll(regex)) {
      if (isPlaceholder(match[0])) {
        continue;
      }
      const index = /** @type {number} */ (match.index);
      out.add(index, index + match[0].length, type, "apiKeys");
    }
  }

  collectPrivateKeys(text, out);
  collectAssignments(text, out);
  collectUrlCredentials(text, out);
  collectAuthHeaders(text, out);
  collectCookies(text, out);
  collectProseSecrets(text, out);
  collectContextCodes(text, out);
  collectHighEntropyNearKeywords(text, out);

  return out.items;
}

/**
 * PEM/OpenSSH/PGP private key blocks, including ones cut off before the END line.
 * @param {string} text
 * @param {Collector} out
 */
function collectPrivateKeys(text, out) {
  const begin = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)-----/g;
  for (const match of text.matchAll(begin)) {
    const start = /** @type {number} */ (match.index);
    const endMarker = `-----END ${match[1]}-----`;
    const endIndex = text.indexOf(endMarker, start);
    if (endIndex !== -1) {
      out.add(start, endIndex + endMarker.length, "PRIVATE_KEY", "apiKeys");
      continue;
    }
    // Truncated: take the base64 body lines (and PEM headers) that follow.
    const body = /\r?\n(?:[A-Za-z0-9+/=]{16,}|[A-Za-z-]+: .*)(?=\r?\n|$)/y;
    body.lastIndex = start + match[0].length;
    let end = body.lastIndex;
    while (body.exec(text) !== null) {
      end = body.lastIndex;
    }
    out.add(start, end, "PRIVATE_KEY", "apiKeys");
  }
}

/**
 * Secret values assigned to secret-sounding keys in env files, JSON, YAML,
 * properties, connection strings and code.
 * @param {string} text
 * @param {Collector} out
 */
function collectAssignments(text, out) {
  for (const regex of [ASSIGNMENT, ARGUMENT_PAIR]) {
    for (const match of text.matchAll(regex)) {
      const key = match[1];
      const quoted = match[2] ?? match[3];
      const isArgumentPair = regex === ARGUMENT_PAIR;
      const unquoted = isArgumentPair ? undefined : match[4];
      const value = quoted ?? unquoted ?? "";
      const group = quoted !== undefined ? (match[2] !== undefined ? 2 : 3) : 4;

      const keyKind = classifyKey(key);
      // Cookie headers hold many name=value pairs; collectCookies handles them.
      if (!keyKind || isPlaceholder(value) || /^(?:set-)?cookie$/i.test(key)) {
        continue;
      }
      if (unquoted !== undefined && looksLikeCode(unquoted, text, /** @type {number} */ (match.index))) {
        continue;
      }
      if (value.length < 4 || (keyKind === "weak" && !looksRandom(value))) {
        continue;
      }
      // A URL value is handled by the URL rules, which only redact its secret part.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        continue;
      }
      out.addGroup(match, group, "SECRET", "credentials", keyKind === "weak" ? "medium" : "high");
    }
  }
}

/**
 * @param {string} key
 * @returns {"strong" | "weak" | null}
 */
function classifyKey(key) {
  const normalised = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-. ]+/g, "_");
  const last = normalised.split("_").slice(-3).join("_");
  if (NOT_A_SECRET_KEY.test(last)) {
    return null;
  }
  if (SECRET_KEY.test(last) || SECRET_KEY.test(normalised)) {
    return "strong";
  }
  return WEAK_SECRET_KEY.test(last) ? "weak" : null;
}

/**
 * Whether an unquoted right-hand side is an expression, not a literal secret:
 * `getToken()`, `form.password.value`, `os.environ[...]`, `API_KEY`, `$DB_PASS`.
 * @param {string} value
 * @param {string} text
 * @param {number} index
 */
function looksLikeCode(value, text, index) {
  const trimmed = value.replace(/[.,;:)\]]+$/, "");
  if (/^[$@&*]|[()[\]]/.test(value) || /^\$\{?\w/.test(trimmed)) {
    return true;
  }
  if (CODE_WORDS.test(trimmed)) {
    return true;
  }
  // Dotted identifier path: settings.SECRET_KEY, form.password.value.
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(trimmed)) {
    return true;
  }
  // SCREAMING_CASE constant reference, e.g. api_key=API_KEY.
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(trimmed)) {
    return true;
  }
  // In code (a declaration keyword on the line), a bare identifier is a variable.
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const linePrefix = text.slice(lineStart, index);
  if (/\b(?:const|let|var|val|final|private|public|return|def|func|fn)\b/.test(linePrefix) && /^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Passwords in URLs (scheme://user:pass@host), tokens used as the user part,
 * and URLs whose query string carries a secret.
 * @param {string} text
 * @param {Collector} out
 */
function collectUrlCredentials(text, out) {
  const url = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi;
  for (const match of text.matchAll(url)) {
    const start = /** @type {number} */ (match.index);
    const raw = match[0].replace(/[.,;:!?)\]}]+$/, "");
    const schemeEnd = raw.indexOf("://") + 3;
    const authorityEnd = findAuthorityEnd(raw, schemeEnd);
    const authority = raw.slice(schemeEnd, authorityEnd);
    const at = authority.lastIndexOf("@");

    if (at > 0) {
      const userinfo = authority.slice(0, at);
      const colon = userinfo.indexOf(":");
      if (colon !== -1) {
        const password = userinfo.slice(colon + 1);
        if (!isPlaceholder(password) && password.length >= 3) {
          const passwordStart = start + schemeEnd + colon + 1;
          out.add(passwordStart, passwordStart + password.length, "PASSWORD", "credentials");
        }
      } else if (userinfo.length >= 20 && looksRandom(userinfo)) {
        out.add(start + schemeEnd, start + schemeEnd + userinfo.length, "SECRET", "credentials");
      }
    }

    const query = raw.indexOf("?", authorityEnd);
    if (query !== -1 && hasSecretParameter(raw.slice(query + 1))) {
      out.add(start, start + raw.length, "SECRET_URL", "credentials");
    }
  }
}

/**
 * The authority ends at the first "/", "?" or "#" after the last "@" before
 * the path. Passwords often contain "@", "#" or "?", so those only end the
 * authority once the "@" separating the user info has been passed.
 * @param {string} url
 * @param {number} from
 */
function findAuthorityEnd(url, from) {
  const rest = url.slice(from);
  const slash = rest.indexOf("/");
  const head = slash === -1 ? rest : rest.slice(0, slash);
  const lastAt = head.lastIndexOf("@");
  const searchFrom = lastAt === -1 ? 0 : lastAt;
  const end = rest.slice(searchFrom).search(/[/?#]/);
  return from + (end === -1 ? rest.length : searchFrom + end);
}

/** @param {string} query */
function hasSecretParameter(query) {
  for (const pair of query.split(/[&;]/)) {
    const [name, value = ""] = pair.split("=");
    const key = decodeSafe(name).toLowerCase();
    if (value.length >= 6 && /^(?:x-amz-signature|x-goog-signature|x-amz-security-token|sig|signature|token|access_token|id_token|refresh_token|auth|auth_token|api_key|apikey|key|secret|client_secret|password|pwd|pass|session|sessionid|sid|code|otp|reset_token|jwt)$/.test(key)) {
      return true;
    }
  }
  return false;
}

/** @param {string} value */
function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

/**
 * Authorization: Bearer/Basic/Token values.
 * @param {string} text
 * @param {Collector} out
 */
function collectAuthHeaders(text, out) {
  const scheme = /\b(?:Bearer|Basic|Token|Digest)\s+([A-Za-z0-9._~+/=-]{12,})/dg;
  for (const match of text.matchAll(scheme)) {
    const index = /** @type {number} */ (match.index);
    const context = before(text, index, 40);
    const isBearer = /^bearer/i.test(match[0]);
    if (isBearer || /authori[sz]ation|auth\b|header/.test(context)) {
      if (!isPlaceholder(match[1]) && (isBearer ? match[1].length >= 16 : true)) {
        out.addGroup(match, 1, "AUTH_TOKEN", "credentials");
      }
    }
  }
}

/**
 * Session, auth and CSRF cookie values in Cookie / Set-Cookie headers.
 * @param {string} text
 * @param {Collector} out
 */
function collectCookies(text, out) {
  const header = /^[ \t]*(?:set-)?cookie:[ \t]*(.*)$/gim;
  for (const match of text.matchAll(header)) {
    const lineStart = /** @type {number} */ (match.index) + match[0].length - match[1].length;
    const pair = /([^=;\s]+)=([^;\s]*)/g;
    for (const cookie of match[1].matchAll(pair)) {
      const [, name, value] = cookie;
      if (/sess|sid|token|auth|csrf|xsrf|jwt|remember|login/i.test(name) && value.length >= 8) {
        const valueStart = lineStart + /** @type {number} */ (cookie.index) + name.length + 1;
        out.add(valueStart, valueStart + value.length, "COOKIE", "credentials");
      }
    }
  }
}

/**
 * "The wifi password is kiwi4471", "vault password is 'correct horse ...'".
 * @param {string} text
 * @param {Collector} out
 */
function collectProseSecrets(text, out) {
  for (const match of text.matchAll(PROSE_SECRET)) {
    const group = match[1] !== undefined ? 1 : match[2] !== undefined ? 2 : 3;
    const value = match[group].replace(/[.,;:!?)]+$/, "");
    if (isPlaceholder(value) || /^(?:required|incorrect|wrong|invalid|correct|expired|too|not|missing|the|a|an|below|above|same|different|changed|reset|sent|valid)$/i.test(value)) {
      continue;
    }
    if (group === 3 && !/\d|[^A-Za-z]/.test(value)) {
      // An unquoted plain word ("the password is strong") is rarely the password.
      continue;
    }
    const indices = /** @type {any} */ (match).indices[group];
    out.add(indices[0], indices[0] + value.length, "SECRET", "credentials", group === 3 ? "medium" : "high");
  }
}

/**
 * Codes listed after "recovery codes", "booking reference" and similar.
 * @param {string} text
 * @param {Collector} out
 */
function collectContextCodes(text, out) {
  for (const match of text.matchAll(CONTEXT_CODES)) {
    const from = /** @type {number} */ (match.index) + match[0].length;
    const plural = /codes\b/i.test(match[0]);
    const window = text.slice(from, from + (plural ? 200 : 40));
    CODE_TOKEN.lastIndex = 0;
    for (const token of window.matchAll(CODE_TOKEN)) {
      const tokenStart = from + /** @type {number} */ (token.index);
      out.add(tokenStart, tokenStart + token[0].length, "SECRET", "credentials", "medium");
      if (!plural) {
        break;
      }
    }
  }
}

/**
 * Long random-looking strings on a line that mentions a key, token or secret.
 * Catches keys from providers that are not in TOKEN_FORMATS.
 * @param {string} text
 * @param {Collector} out
 */
function collectHighEntropyNearKeywords(text, out) {
  const candidate = /(?<![\w/+=.-])[A-Za-z0-9_+/=-]{24,}(?![\w/+=.-])/g;
  for (const match of text.matchAll(candidate)) {
    const value = match[0];
    const index = /** @type {number} */ (match.index);
    if (!looksRandom(value) || /^[a-f0-9]+$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) {
      continue;
    }
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    const linePrefix = text.slice(lineStart, index).toLowerCase();
    if (/sha\d+-$|integrity|checksum|hash|digest|etag/.test(linePrefix)) {
      continue;
    }
    const nearKeyword = /key|token|secret|password|passwd|credential|auth|bearer|signature/.test(linePrefix);
    out.add(index, index + value.length, "SECRET", "credentials", nearKeyword ? "medium" : "low");
  }
}
