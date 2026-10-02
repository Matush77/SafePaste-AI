// The AI chat sites SafePaste works on. Built-in sites are always on (they
// are in the manifest's host_permissions). Optional sites are switched on
// per site from the popup: Chrome asks the user once, and only then does the
// background worker register the content script there, so adding a site to
// this list never adds a permission warning for existing users.

/**
 * @typedef {"chatgpt" | "gemini" | "claude" | "perplexity" | "mistral" | "grok" | "poe"} SiteId
 *
 * @typedef {object} SiteInfo
 * @property {SiteId} id
 * @property {string} name
 * @property {string[]} hosts    Hostnames the site is served from.
 * @property {boolean} optional  Needs the user's permission first.
 */

/** @type {SiteInfo[]} */
export const SITE_LIST = [
  { id: "chatgpt", name: "ChatGPT", hosts: ["chatgpt.com"], optional: false },
  { id: "gemini", name: "Gemini", hosts: ["gemini.google.com"], optional: false },
  { id: "claude", name: "Claude", hosts: ["claude.ai"], optional: false },
  { id: "perplexity", name: "Perplexity", hosts: ["www.perplexity.ai", "perplexity.ai"], optional: true },
  { id: "mistral", name: "Mistral Le Chat", hosts: ["chat.mistral.ai"], optional: true },
  { id: "grok", name: "Grok", hosts: ["grok.com"], optional: true },
  { id: "poe", name: "Poe", hosts: ["poe.com"], optional: true }
];

export const OPTIONAL_SITES = SITE_LIST.filter((site) => site.optional);

/**
 * Match patterns for a site's pages, as used by chrome.permissions and
 * chrome.scripting.
 * @param {SiteInfo} site
 */
export function originsOf(site) {
  return site.hosts.map((host) => `https://${host}/*`);
}

/**
 * @param {string} hostname
 * @returns {SiteInfo | null}
 */
export function siteInfoForHostname(hostname) {
  return SITE_LIST.find((site) => site.hosts.includes(hostname)) || null;
}

/** Content-script registration id for an optional site. */
export const scriptIdOf = (/** @type {SiteInfo} */ site) => `safepaste-${site.id}`;
