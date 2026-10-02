// Keeps SafePaste's content script registered on exactly the optional sites
// the user has allowed (see shared/sites.js). Runs in the background worker
// on install, on browser start, and whenever a site permission is granted
// or removed.

import { OPTIONAL_SITES, originsOf, scriptIdOf } from "./shared/sites.js";

/**
 * @typedef {object} ChromeApi The parts of the chrome.* API this uses.
 * @property {{ getRegisteredContentScripts: () => Promise<{ id: string }[]>, registerContentScripts: (scripts: object[]) => Promise<void>, unregisterContentScripts: (filter: { ids: string[] }) => Promise<void>, executeScript: (injection: object) => Promise<unknown> }} scripting
 * @property {{ contains: (permissions: { origins: string[] }) => Promise<boolean> }} permissions
 * @property {{ query: (query: { url: string[] }) => Promise<{ id?: number }[]> }} tabs
 */

const CONTENT_SCRIPT = "contentScript.js";

/**
 * @param {ChromeApi} api
 * @returns {Promise<{ registered: string[], unregistered: string[] }>}
 */
export async function syncSiteScripts(api) {
  const existing = new Set((await api.scripting.getRegisteredContentScripts()).map((script) => script.id));
  /** @type {string[]} */
  const registered = [];
  /** @type {string[]} */
  const unregistered = [];

  for (const site of OPTIONAL_SITES) {
    const origins = originsOf(site);
    const id = scriptIdOf(site);
    const allowed = await api.permissions.contains({ origins });
    if (allowed && !existing.has(id)) {
      await api.scripting.registerContentScripts([{ id, matches: origins, js: [CONTENT_SCRIPT], runAt: "document_start", persistAcrossSessions: true }]);
      registered.push(id);
      // Tabs already open on the site get protection now, not after a reload.
      for (const tab of await api.tabs.query({ url: origins })) {
        if (tab.id !== undefined) {
          await api.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT] }).catch(() => {});
        }
      }
    } else if (!allowed && existing.has(id)) {
      await api.scripting.unregisterContentScripts({ ids: [id] });
      unregistered.push(id);
    }
  }
  return { registered, unregistered };
}
