// Remembers, for one tab, which original value each placeholder stands for,
// so the same value always gets the same placeholder and replies can be
// copied with the real values back in. Kept in memory only: never stored,
// never sent, and gone when the page is closed or reloaded.

/**
 * @typedef {object} VaultEntry
 * @property {string} key          Placeholder without brackets, e.g. "EMAIL_1".
 * @property {string} type
 * @property {string} value        The original text.
 */

// Any placeholder shape SafePaste writes, and the forms AI replies turn
// them into: [[EMAIL_1]], [EMAIL_1], or a bare EMAIL_1.
const PLACEHOLDER = /\[\[([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_\d+)\]\]|\[([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_\d+)\]|(?<![\w[])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_\d+)(?![\w\]])/g;

export function createVault() {
  /** @type {Map<string, VaultEntry>} by key */
  const byKey = new Map();
  /** @type {Map<string, VaultEntry>} by type + value */
  const byValue = new Map();
  /** @type {Map<string, number>} */
  const counters = new Map();

  return {
    /**
     * The placeholder for a value, the same one every time it is seen.
     * @param {string} type
     * @param {string} value
     * @param {"typed" | "compact"} style
     */
    placeholderFor(type, value, style) {
      const valueKey = `${type}\u0000${value}`;
      let entry = byValue.get(valueKey);
      if (!entry) {
        const count = (counters.get(type) || 0) + 1;
        counters.set(type, count);
        const key = `${type}_${count}`;
        entry = { key, type, value };
        byValue.set(valueKey, entry);
        byKey.set(key, entry);
      }
      return style === "compact" ? `[${entry.key}]` : `[[${entry.key}]]`;
    },

    /** @param {string} key */
    get(key) {
      return byKey.get(key) || null;
    },

    get size() {
      return byKey.size;
    },

    /**
     * Known placeholders in a text, with their positions.
     * @param {string} text
     * @returns {{ start: number, end: number, entry: VaultEntry }[]}
     */
    find(text) {
      if (!byKey.size) {
        return [];
      }
      const found = [];
      for (const match of text.matchAll(PLACEHOLDER)) {
        const entry = byKey.get(match[1] || match[2] || match[3]);
        if (entry) {
          const start = /** @type {number} */ (match.index);
          found.push({ start, end: start + match[0].length, entry });
        }
      }
      return found;
    },

    /**
     * The text with every known placeholder replaced by its original value.
     * @param {string} text
     */
    restore(text) {
      let output = "";
      let cursor = 0;
      for (const { start, end, entry } of this.find(text)) {
        output += text.slice(cursor, start) + entry.value;
        cursor = end;
      }
      return output + text.slice(cursor);
    }
  };
}

/** @typedef {ReturnType<typeof createVault>} Vault */
