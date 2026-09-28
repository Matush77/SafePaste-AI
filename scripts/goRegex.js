// Converts regular expressions written for Go's RE2 engine (gitleaks rules)
// to JavaScript: (?P<name> becomes (?<name>, \z and \A become $ and ^, POSIX
// classes such as [[:alnum:]] become explicit ranges, and inline
// case-insensitivity ((?i) mid-pattern, (?i:...), (?-i:...)), which neither
// Node 22 nor Chrome 116 support, is expanded into [aA] classes.

// RE2's ASCII POSIX classes, as JavaScript class contents.
const POSIX_CLASSES = {
  alnum: "0-9A-Za-z",
  alpha: "A-Za-z",
  ascii: "\\x00-\\x7F",
  blank: "\\t ",
  cntrl: "\\x00-\\x1F\\x7F",
  digit: "0-9",
  graph: "!-~",
  lower: "a-z",
  print: " -~",
  punct: "!-\\/:-@\\[-`{-~",
  space: "\\t\\n\\v\\f\\r ",
  upper: "A-Z",
  word: "0-9A-Za-z_",
  xdigit: "0-9A-Fa-f"
};

/**
 * @param {string} pattern Go RE2 pattern.
 * @returns {{ source: string, flags: string }}
 */
export function convertRegex(pattern) {
  // (?s:.) is "any character including newline".
  let source = pattern.replace(/\(\?P</g, "(?<").replace(/\(\?s:\.\)/g, "[\\s\\S]");
  let flags = "";
  // A leading (?i) with no other inline flags becomes the "i" flag.
  if (source.startsWith("(?i)") && !/\(\?-?i[:)]/.test(source.slice(4))) {
    source = source.slice(4);
    flags = "i";
  }
  return { source: expandInlineFlags(source), flags };
}

/**
 * Rewrites (?i), (?i:...) and (?-i:...) into explicit case classes, \z and
 * \A into $ and ^, and POSIX classes into ranges.
 * @param {string} pattern
 */
function expandInlineFlags(pattern) {
  /** @type {boolean[]} Case-insensitive state per open group. */
  const stack = [false];
  let out = "";
  let i = 0;
  const insensitive = () => stack[stack.length - 1];

  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "\\") {
      const next = pattern[i + 1];
      if (next === "z") {
        out += "$";
      } else if (next === "A") {
        out += "^";
      } else {
        out += char + next;
      }
      i += 2;
      continue;
    }
    if (char === "[") {
      const end = findClassEnd(pattern, i);
      const body = expandPosixClasses(pattern.slice(i + 1, end));
      out += `[${insensitive() ? caseFoldClass(body) : body}]`;
      i = end + 1;
      continue;
    }
    if (pattern.startsWith("(?i)", i)) {
      stack[stack.length - 1] = true;
      i += 4;
      continue;
    }
    if (pattern.startsWith("(?-i)", i)) {
      stack[stack.length - 1] = false;
      i += 5;
      continue;
    }
    if (pattern.startsWith("(?i:", i)) {
      stack.push(true);
      out += "(?:";
      i += 4;
      continue;
    }
    if (pattern.startsWith("(?-i:", i)) {
      stack.push(false);
      out += "(?:";
      i += 5;
      continue;
    }
    if (char === "(") {
      stack.push(insensitive());
      out += char;
      i += 1;
      continue;
    }
    if (char === ")") {
      stack.pop();
      out += char;
      i += 1;
      continue;
    }
    if (insensitive() && /[a-z]/i.test(char)) {
      out += `[${char.toLowerCase()}${char.toUpperCase()}]`;
    } else {
      out += char;
    }
    i += 1;
  }
  return out;
}

/**
 * @param {string} pattern
 * @param {number} start Index of "[".
 */
function findClassEnd(pattern, start) {
  let i = start + 1;
  if (pattern[i] === "^") {
    i += 1;
  }
  if (pattern[i] === "]") {
    i += 1;
  }
  while (i < pattern.length) {
    if (pattern[i] === "\\") {
      i += 2;
      continue;
    }
    const posix = /^\[:\^?([a-z]+):\]/.exec(pattern.slice(i));
    if (posix) {
      i += posix[0].length;
      continue;
    }
    if (pattern[i] === "]") {
      return i;
    }
    i += 1;
  }
  throw new Error("unterminated character class");
}

/**
 * "[:alnum:]_" -> "0-9A-Za-z_". Negated POSIX classes have no JavaScript
 * equivalent inside a class, so they are rejected.
 * @param {string} body Class contents without the outer brackets.
 */
function expandPosixClasses(body) {
  return body.replace(/\\.|\[:(\^?)([a-z]+):\]/g, (whole, negated, name) => {
    if (!name) {
      return whole;
    }
    const expansion = /** @type {Record<string, string>} */ (POSIX_CLASSES)[name];
    if (negated || !expansion) {
      throw new Error(`unsupported POSIX class ${whole}`);
    }
    return expansion;
  });
}

/**
 * Adds the other case of every letter and letter range in a class body.
 * @param {string} body
 */
function caseFoldClass(body) {
  let extra = "";
  for (const match of body.matchAll(/\\.|([a-zA-Z])-([a-zA-Z])|([a-zA-Z])/g)) {
    if (match[1]) {
      const swap = (/** @type {string} */ c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
      extra += `${swap(match[1])}-${swap(match[2])}`;
    } else if (match[3]) {
      const c = match[3];
      extra += c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
    }
  }
  return body + extra;
}
