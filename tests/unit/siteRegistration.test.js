// Optional sites: the content script is registered exactly where the user
// allowed SafePaste, and open tabs there are protected straight away.
import { describe, expect, it } from "vitest";
import { OPTIONAL_SITES, SITE_LIST, originsOf, siteInfoForHostname } from "../../src/shared/sites.js";
import { syncSiteScripts } from "../../src/siteRegistration.js";

/**
 * A fake chrome.* API.
 * @param {{ allowed: string[], registered?: string[], tabs?: { id: number, url: string }[] }} state
 */
function fakeChrome({ allowed, registered = [], tabs = [] }) {
  const scripts = new Set(registered);
  /** @type {number[]} */
  const injected = [];
  const api = {
    scripting: {
      getRegisteredContentScripts: async () => [...scripts].map((id) => ({ id })),
      registerContentScripts: async (/** @type {{ id: string }[]} */ list) => list.forEach((script) => scripts.add(script.id)),
      unregisterContentScripts: async (/** @type {{ ids: string[] }} */ filter) => filter.ids.forEach((id) => scripts.delete(id)),
      executeScript: async (/** @type {{ target: { tabId: number } }} */ injection) => injected.push(injection.target.tabId)
    },
    permissions: {
      contains: async (/** @type {{ origins: string[] }} */ request) => request.origins.every((origin) => allowed.includes(origin))
    },
    tabs: {
      query: async (/** @type {{ url: string[] }} */ query) =>
        tabs.filter((tab) => query.url.some((pattern) => tab.url.startsWith(pattern.replace("/*", "/"))))
    }
  };
  return { api, scripts, injected };
}

const perplexity = /** @type {import("../../src/shared/sites.js").SiteInfo} */ (OPTIONAL_SITES.find((site) => site.id === "perplexity"));

describe("optional site registration", () => {
  it("registers the content script only on allowed sites and injects into open tabs", async () => {
    const { api, scripts, injected } = fakeChrome({
      allowed: originsOf(perplexity),
      tabs: [{ id: 7, url: "https://www.perplexity.ai/search/abc" }, { id: 8, url: "https://grok.com/" }]
    });
    const result = await syncSiteScripts(api);
    expect(result.registered).toEqual(["safepaste-perplexity"]);
    expect([...scripts]).toEqual(["safepaste-perplexity"]);
    expect(injected).toEqual([7]);
  });

  it("unregisters a site whose permission was removed, and is idempotent", async () => {
    const { api, scripts } = fakeChrome({ allowed: [], registered: ["safepaste-perplexity"] });
    expect((await syncSiteScripts(api)).unregistered).toEqual(["safepaste-perplexity"]);
    expect(scripts.size).toBe(0);
    expect(await syncSiteScripts(api)).toEqual({ registered: [], unregistered: [] });
  });
});

describe("site list", () => {
  it("knows every host of every site, and keeps ids unique", () => {
    expect(siteInfoForHostname("perplexity.ai")?.id).toBe("perplexity");
    expect(siteInfoForHostname("www.perplexity.ai")?.id).toBe("perplexity");
    expect(siteInfoForHostname("chatgpt.com")?.optional).toBe(false);
    expect(siteInfoForHostname("example.com")).toBeNull();
    expect(new Set(SITE_LIST.map((site) => site.id)).size).toBe(SITE_LIST.length);
  });
});
