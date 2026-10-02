// First-run page: a practice paste with the real engine, the reply with
// placeholders and "Copy with real values", and switching on more sites.
// Nothing here is sent anywhere; the sample data is made up.

import { redact } from "../redactor.js";
import { SITE_LIST, originsOf } from "../shared/sites.js";
import { createVault } from "../vault.js";

const SAMPLE = [
  "Hi, please draft a reply to this customer:",
  "",
  "From: Rebecca Thornton <rebecca.thornton@gmail.com>",
  "Phone: (614) 555-0187",
  "Card on file: 4111 1111 1111 1111",
  "",
  "She was charged twice for order 5521 and wants a refund."
].join("\n");

const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const practice = /** @type {HTMLTextAreaElement} */ (byId("practice"));
const vault = createVault();
let replyText = "";

byId("sample").textContent = SAMPLE;
byId("version").textContent = `SafePaste AI ${chrome.runtime.getManifest().version}`;

byId("copySample").addEventListener("click", async (event) => {
  const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
  try {
    await navigator.clipboard.writeText(SAMPLE);
    button.textContent = "Copied";
  } catch (_error) {
    button.textContent = "Select and copy it";
  }
  practice.focus();
});

// The same engine as on the AI sites, with the default settings.
practice.addEventListener("paste", (event) => {
  const text = event.clipboardData ? event.clipboardData.getData("text/plain") : "";
  if (!text) {
    return;
  }
  event.preventDefault();
  const result = redact(text, {}, undefined, { placeholderFor: (type, value) => vault.placeholderFor(type, value, "typed") });
  practice.setRangeText(result.text, practice.selectionStart, practice.selectionEnd, "end");
  // Show the whole pasted text.
  practice.style.height = "auto";
  practice.style.height = `${practice.scrollHeight + 2}px`;
  showHidden(result.text);
  showReply(result.text);
});

/** @param {string} redacted */
function showHidden(redacted) {
  const found = vault.find(redacted);
  const unique = [...new Map(found.map(({ entry }) => [entry.key, entry])).values()];
  const list = byId("hiddenItems");
  list.textContent = "";
  for (const entry of unique) {
    const item = document.createElement("li");
    const type = document.createElement("span");
    type.className = "type";
    type.textContent = entry.type.replace(/_/g, " ").toLowerCase();
    const value = document.createElement("span");
    value.textContent = entry.value;
    item.append(type, value);
    list.append(item);
  }
  byId("hiddenCount").textContent = String(unique.length);
  byId("hiddenList").hidden = unique.length === 0;
}

/**
 * A reply in the style an AI writes, using the placeholders it was given.
 * @param {string} redacted
 */
function showReply(redacted) {
  const keys = new Map(vault.find(redacted).map(({ entry }) => [entry.type, `[[${entry.key}]]`]));
  if (!keys.size) {
    return;
  }
  const person = keys.get("PERSON") || "there";
  const email = keys.get("EMAIL");
  const card = keys.get("CREDIT_CARD");
  replyText = [
    `Dear ${person},`,
    "",
    `Thank you for letting us know. We are sorry you were charged twice. We have refunded the second charge${card ? ` to your card ${card}` : ""}; it should appear within 3 to 5 business days.${email ? ` A confirmation is on its way to ${email}.` : ""}`,
    "",
    "Kind regards,",
    "Customer Support"
  ].join("\n");

  const reply = byId("reply");
  reply.textContent = "";
  let cursor = 0;
  for (const { start, end, entry } of vault.find(replyText)) {
    reply.append(replyText.slice(cursor, start));
    const mark = document.createElement("span");
    mark.className = "ph";
    mark.textContent = replyText.slice(start, end);
    mark.dataset.key = entry.key;
    mark.tabIndex = 0;
    reply.append(mark);
    cursor = end;
  }
  reply.append(replyText.slice(cursor));
  reply.style.whiteSpace = "pre-wrap";
  byId("replyCard").hidden = false;
  byId("copied").hidden = true;
  byId("replyCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Hover (or focus) a placeholder to see its real value.
const peek = byId("peek");
for (const type of ["mouseover", "focusin"]) {
  byId("reply").addEventListener(type, (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const entry = target.dataset && target.dataset.key ? vault.get(target.dataset.key) : null;
    if (!entry) {
      return;
    }
    peek.textContent = "";
    const value = document.createElement("b");
    value.textContent = entry.value;
    const note = document.createElement("span");
    note.textContent = `Real value of ${entry.key}, hidden from the AI`;
    peek.append(value, note);
    const rect = target.getBoundingClientRect();
    peek.hidden = false;
    peek.style.left = `${Math.min(rect.left, window.innerWidth - peek.offsetWidth - 12)}px`;
    peek.style.top = `${rect.bottom + 6}px`;
  });
}
for (const type of ["mouseout", "focusout"]) {
  byId("reply").addEventListener(type, () => {
    peek.hidden = true;
  });
}

byId("copyReply").addEventListener("click", async () => {
  const restored = vault.restore(replyText);
  byId("copiedText").textContent = restored;
  byId("copied").hidden = false;
  try {
    await navigator.clipboard.writeText(restored);
  } catch (_error) {
    // The text is shown below the button either way.
  }
});

// Where SafePaste works, with one-click switching on of optional sites.
async function renderSites() {
  const rows = byId("siteRows");
  rows.textContent = "";
  for (const site of SITE_LIST) {
    const row = document.createElement("div");
    row.className = "site";
    const name = document.createElement("span");
    name.className = "site-name";
    name.textContent = site.name;
    const host = document.createElement("span");
    host.className = "site-host";
    host.textContent = site.hosts[site.hosts.length - 1];
    name.append(host);
    row.append(name);

    const allowed = !site.optional || (await chrome.permissions.contains({ origins: originsOf(site) }));
    if (allowed) {
      const on = document.createElement("span");
      on.className = "on";
      on.textContent = site.optional ? "On" : "On, always";
      row.append(on);
    } else {
      const button = document.createElement("button");
      button.className = "button";
      button.type = "button";
      button.textContent = "Turn on";
      button.setAttribute("aria-label", `Turn on SafePaste for ${site.name}`);
      button.addEventListener("click", async () => {
        const granted = await chrome.permissions.request({ origins: originsOf(site) }).catch(() => false);
        if (granted) {
          renderSites();
        }
      });
      row.append(button);
    }
    rows.append(row);
  }
}
renderSites();
