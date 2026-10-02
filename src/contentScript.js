// Content-script entry point. Bundled by scripts/build.js into a single file.
import { installPasteGuard, showToast } from "./pasteGuard.js";
import { installReplyAssist } from "./replyAssist.js";
import { createReviewChip } from "./reviewChip.js";
import { MESSAGES } from "./shared/nameModel.js";
import { SETTINGS_KEY } from "./shared/storageKeys.js";
import { currentSite } from "./siteAdapters.js";
import { createVault } from "./vault.js";

const site = currentSite();
if (site) {
  // Load the name model in the background so the first paste does not wait.
  chrome.storage.sync.get(SETTINGS_KEY).then((items) => {
    const stored = /** @type {{ nameModel?: boolean } | undefined} */ (items[SETTINGS_KEY]);
    if (stored && stored.nameModel === true) {
      chrome.runtime.sendMessage({ type: MESSAGES.prepare }).catch(() => {});
    }
  }).catch(() => {});

  const notify = (/** @type {string} */ message) => showToast(document, message);
  // Placeholders and their real values for this tab, in memory only.
  const vault = createVault();
  /** @type {ReturnType<typeof installPasteGuard> | null} */
  let guard = null;
  const settings = () => (guard ? guard.settings() : null);

  const replies = installReplyAssist({
    vault,
    site,
    notify,
    isEnabled: () => Boolean(settings()?.restoreValues),
    onChange: () => review.render()
  });
  const review = createReviewChip({
    vault,
    replies,
    notify,
    settings: () => ({ notice: Boolean(settings()?.showToast), restoreValues: Boolean(settings()?.restoreValues) })
  });

  guard = installPasteGuard({
    site,
    storage: chrome.storage,
    notify,
    vault,
    onRedacted(editable) {
      replies.activate();
      review.setEditor(editable);
    },
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

  // Settings changed in the popup: redraw highlights and the chip.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[SETTINGS_KEY]) {
      setTimeout(() => replies.refresh(), 0);
    }
  });
}
