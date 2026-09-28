// Content-script entry point. Bundled by scripts/build.js into a single file.
import { installPasteGuard } from "./pasteGuard.js";
import { MESSAGES } from "./shared/nameModel.js";
import { SETTINGS_KEY } from "./shared/storageKeys.js";
import { currentSite } from "./siteAdapters.js";

const site = currentSite();
if (site) {
  // Load the name model in the background so the first paste does not wait.
  chrome.storage.sync.get(SETTINGS_KEY).then((items) => {
    const stored = /** @type {{ nameModel?: boolean } | undefined} */ (items[SETTINGS_KEY]);
    if (stored && stored.nameModel === true) {
      chrome.runtime.sendMessage({ type: MESSAGES.prepare }).catch(() => {});
    }
  }).catch(() => {});

  installPasteGuard({
    site,
    storage: chrome.storage,
    nameModel: {
      async detect(text) {
        const response = await chrome.runtime.sendMessage({ type: MESSAGES.detect, text });
        if (!response || response.error || !Array.isArray(response.candidates)) {
          throw new Error(response && response.error ? response.error : "No response from the name model");
        }
        return response.candidates;
      }
    }
  });
}
