(function () {
  "use strict";

  const STORAGE_KEY = "sensitivePasteSettings";
  const LAST_REDACTION_KEY = "lastSensitivePasteRedaction";

  const CATEGORY_NAMES = {
    apiKeys: "API keys and tokens",
    credentials: "Credentials in key/value text",
    emails: "Email addresses",
    phones: "Phone numbers",
    financial: "Credit cards and IBANs",
    governmentIds: "Government IDs",
    network: "IP and MAC addresses",
    addresses: "Street addresses",
    people: "People names",
    organizations: "Organizations",
    locations: "Locations",
    urls: "URLs"
  };

  const enabled = document.getElementById("enabled");
  const categories = document.getElementById("categories");
  const placeholderStyle = document.getElementById("placeholderStyle");
  const showToast = document.getElementById("showToast");
  const lastRedaction = document.getElementById("lastRedaction");

  let settings = window.SensitivePasteRedactor.mergeSettings();

  init();

  function init() {
    renderCategoryControls();
    chrome.storage.sync.get(STORAGE_KEY, (items) => {
      settings = window.SensitivePasteRedactor.mergeSettings(items[STORAGE_KEY]);
      renderSettings();
    });

    chrome.storage.local.get(LAST_REDACTION_KEY, (items) => {
      renderLastRedaction(sanitizeLastRedaction(items[LAST_REDACTION_KEY]));
    });

    enabled.addEventListener("change", () => updateSettings({ enabled: enabled.checked }));
    placeholderStyle.addEventListener("change", () => updateSettings({ placeholderStyle: placeholderStyle.value }));
    showToast.addEventListener("change", () => updateSettings({ showToast: showToast.checked }));
  }

  function renderCategoryControls() {
    categories.textContent = "";
    for (const [key, label] of Object.entries(CATEGORY_NAMES)) {
      const row = document.createElement("label");
      row.className = "toggle";

      const text = document.createElement("span");
      text.textContent = label;

      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.category = key;
      input.addEventListener("change", () => {
        updateSettings({
          categories: {
            ...settings.categories,
            [key]: input.checked
          }
        });
      });

      row.append(text, input);
      categories.append(row);
    }
  }

  function renderSettings() {
    enabled.checked = settings.enabled;
    placeholderStyle.value = settings.placeholderStyle;
    showToast.checked = settings.showToast;

    for (const input of categories.querySelectorAll("input[data-category]")) {
      input.checked = Boolean(settings.categories[input.dataset.category]);
    }
  }

  function updateSettings(patch) {
    settings = window.SensitivePasteRedactor.mergeSettings({
      ...settings,
      ...patch,
      categories: {
        ...settings.categories,
        ...patch.categories
      }
    });

    chrome.storage.sync.set({ [STORAGE_KEY]: settings }, renderSettings);
  }

  function renderLastRedaction(summary) {
    if (!summary) {
      lastRedaction.textContent = "No redactions yet.";
      return;
    }

    const counts = summary.findings && summary.findings.counts ? summary.findings.counts : {};
    const countText = Object.entries(counts)
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ");

    lastRedaction.innerHTML = "";
    const top = document.createElement("div");
    top.textContent = `${summary.site || "Site"} at ${formatTime(summary.timestamp)}`;
    const bottom = document.createElement("div");
    bottom.className = "muted";
    bottom.textContent = countText || "No sensitive text found.";
    lastRedaction.append(top, bottom);
  }

  function sanitizeLastRedaction(summary) {
    if (!summary || !Object.prototype.hasOwnProperty.call(summary, "redactedText")) {
      return summary;
    }

    const sanitized = { ...summary };
    delete sanitized.redactedText;
    chrome.storage.local.set({ [LAST_REDACTION_KEY]: sanitized });
    return sanitized;
  }

  function formatTime(value) {
    if (!value) {
      return "unknown time";
    }
    return new Date(value).toLocaleString();
  }

})();
