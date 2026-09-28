// Content-script entry point. Bundled by scripts/build.js into a single file.
import { installPasteGuard } from "./pasteGuard.js";
import { currentSite } from "./siteAdapters.js";

const site = currentSite();
if (site) {
  installPasteGuard({ site, storage: chrome.storage });
}
