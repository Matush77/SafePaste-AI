(function () {
  "use strict";

  const STORAGE_KEY = "sensitivePasteSettings";
  const LAST_REDACTION_KEY = "lastSensitivePasteRedaction";

  let settings = window.SensitivePasteRedactor.mergeSettings({ enabled: false });
  let settingsLoaded = false;
  const handledPasteEvents = new WeakSet();
  const site = window.SensitivePasteSites.currentSite();

  if (!site) {
    return;
  }

  removeLegacyRedactedText();

  chrome.storage.sync.get(STORAGE_KEY, (items) => {
    if (chrome.runtime.lastError) {
      settings = window.SensitivePasteRedactor.mergeSettings({ enabled: false });
      settingsLoaded = true;
      return;
    }
    settings = window.SensitivePasteRedactor.mergeSettings(items[STORAGE_KEY]);
    settingsLoaded = true;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[STORAGE_KEY]) {
      settings = window.SensitivePasteRedactor.mergeSettings(changes[STORAGE_KEY].newValue);
    }
  });

  window.addEventListener("paste", onPaste, true);
  document.addEventListener("paste", onPaste, true);

  function onPaste(event) {
    if (handledPasteEvents.has(event)) {
      return;
    }

    if (!settingsLoaded || !settings.enabled) {
      return;
    }

    const editable = window.SensitivePasteSites.promptEditableFromEvent(event, site);
    if (!editable) {
      return;
    }

    const clipboard = event.clipboardData;
    const plainText = clipboard && clipboard.getData("text/plain");
    if (!plainText) {
      return;
    }

    const result = window.SensitivePasteRedactor.redact(plainText, settings);
    if (!result.changed) {
      return;
    }

    handledPasteEvents.add(event);
    event.preventDefault();
    event.stopImmediatePropagation();

    const inserted = window.SensitivePasteSites.insertText(editable, result.text);
    if (inserted) {
      if (settings.showToast) {
        showRedactionToast(result.findings);
      }

      chrome.storage.local.set({
        [LAST_REDACTION_KEY]: {
          site: site.name,
          url: location.origin,
          timestamp: new Date().toISOString(),
          findings: summarizeFindings(result.findings)
        }
      });
    }
  }

  function showRedactionToast(findings) {
    if (!document.body || typeof document.createElement !== "function") {
      return;
    }

    const total = findings.length;
    const container = document.createElement("div");
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    container.textContent = `SafePaste AI: redacted ${total} ${total === 1 ? "item" : "items"}.`;
    Object.assign(container.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      background: "#172033",
      color: "#ffffff",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
      font: "13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      maxWidth: "320px",
      padding: "10px 12px",
      pointerEvents: "none"
    });

    document.body.append(container);
    setTimeout(() => {
      container.remove();
    }, 3200);
  }

  function summarizeFindings(findings) {
    const counts = {};
    for (const finding of findings) {
      counts[finding.type] = (counts[finding.type] || 0) + 1;
    }
    return {
      counts,
      total: findings.length
    };
  }

  function removeLegacyRedactedText() {
    chrome.storage.local.get(LAST_REDACTION_KEY, (items) => {
      const summary = items[LAST_REDACTION_KEY];
      if (!summary || !Object.prototype.hasOwnProperty.call(summary, "redactedText")) {
        return;
      }

      const sanitized = { ...summary };
      delete sanitized.redactedText;
      chrome.storage.local.set({ [LAST_REDACTION_KEY]: sanitized });
    });
  }
})();
