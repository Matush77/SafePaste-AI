// @vitest-environment jsdom
// Consistent placeholders across pastes, the review chip, and copying
// replies with the real values filled back in.
import { afterEach, describe, expect, it } from "vitest";
import { installPasteGuard } from "../../src/pasteGuard.js";
import { installReplyAssist } from "../../src/replyAssist.js";
import { createReviewChip } from "../../src/reviewChip.js";
import { createVault } from "../../src/vault.js";

/** @type {import("../../src/siteAdapters.js").Site} */
const site = { id: "chatgpt", name: "ChatGPT" };

/** @type {(() => void)[]} */
let cleanups = [];

afterEach(() => {
  for (const cleanup of cleanups) {
    cleanup();
  }
  cleanups = [];
  document.body.innerHTML = "";
  document.querySelectorAll("safepaste-ui").forEach((element) => element.remove());
});

const storage = {
  sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
  local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
  onChanged: { addListener: () => {} }
};

/** @param {string} html */
function mount(html) {
  document.body.insertAdjacentHTML("beforeend", html);
  return /** @type {HTMLElement} */ (document.body.lastElementChild);
}

/**
 * @param {Element} target
 * @param {string} text
 */
function paste(target, text) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: (/** @type {string} */ type) => (type === "text/plain" ? text : "") } });
  target.dispatchEvent(event);
}

function setup() {
  const vault = createVault();
  /** @type {string[]} */
  const notices = [];
  const notify = (/** @type {string} */ message) => notices.push(message);
  const settings = { notice: true, restoreValues: true };
  const replies = installReplyAssist({ vault, site, notify, isEnabled: () => settings.restoreValues, onChange: () => review.render() });
  const review = createReviewChip({ vault, replies, notify, settings: () => settings, shadowMode: "open" });
  /** @type {HTMLElement[]} */
  const redactedInto = [];
  const guard = installPasteGuard({
    site,
    storage,
    notify,
    vault,
    onRedacted(editable) {
      redactedInto.push(editable);
      replies.activate();
      review.setEditor(editable);
    }
  });
  cleanups.push(guard.dispose);
  const chip = () => /** @type {ShadowRoot} */ (/** @type {HTMLElement} */ (document.querySelector("safepaste-ui")).shadowRoot);
  return { vault, guard, notices, replies, review, redactedInto, chip };
}

describe("vault", () => {
  it("gives a value the same placeholder every time and numbers new ones", () => {
    const vault = createVault();
    expect(vault.placeholderFor("EMAIL", "a@example.com", "typed")).toBe("[[EMAIL_1]]");
    expect(vault.placeholderFor("EMAIL", "b@example.com", "typed")).toBe("[[EMAIL_2]]");
    expect(vault.placeholderFor("EMAIL", "a@example.com", "compact")).toBe("[EMAIL_1]");
  });

  it("restores the forms placeholders take in AI replies, and only known ones", () => {
    const vault = createVault();
    vault.placeholderFor("PERSON", "Rebecca Thornton", "typed");
    vault.placeholderFor("EMAIL", "rebecca@example.com", "typed");
    expect(vault.restore("Dear [[PERSON_1]], write to [EMAIL_1] or EMAIL_1. Not [[PERSON_2]] or MAX_1."))
      .toBe("Dear Rebecca Thornton, write to rebecca@example.com or rebecca@example.com. Not [[PERSON_2]] or MAX_1.");
  });
});

describe("placeholders across pastes", () => {
  it("keeps one placeholder per value across pastes in a tab", async () => {
    const { guard } = setup();
    await guard.ready;
    const prompt = /** @type {HTMLTextAreaElement} */ (mount(`<textarea id="prompt-textarea"></textarea>`));
    paste(prompt, "Mail jane.smith@example.com. ");
    paste(prompt, "Again jane.smith@example.com and bob.lee@example.org.");
    expect(prompt.value).toBe("Mail [[EMAIL_1]]. Again [[EMAIL_1]] and [[EMAIL_2]].");
  });
});

describe("review chip", () => {
  it("lists what was hidden instead of a notice, and unhides one item", async () => {
    const { guard, notices, chip } = setup();
    await guard.ready;
    const prompt = /** @type {HTMLTextAreaElement} */ (mount(`<textarea id="prompt-textarea"></textarea>`));
    paste(prompt, "Contact Dr. Jane Smith at jane.smith@example.com.");

    expect(notices).toEqual([]);
    const root = chip();
    expect(/** @type {HTMLElement} */ (root.querySelector(".review")).textContent).toBe("2 hidden · Review");
    /** @type {HTMLButtonElement} */ (root.querySelector(".review")).click();
    const rows = [...root.querySelectorAll(".items li")].map((row) => row.textContent);
    expect(rows).toEqual(["personJane SmithUnhide", "emailjane.smith@example.comUnhide"]);

    /** @type {HTMLButtonElement} */ (root.querySelector("[aria-label='Unhide EMAIL_1']")).click();
    expect(prompt.value).toBe("Contact Dr. [[PERSON_1]] at jane.smith@example.com.");
    expect(/** @type {HTMLElement} */ (root.querySelector(".review")).textContent).toBe("1 hidden · Review");
  });

  it("hides itself once the message no longer contains hidden values", async () => {
    const { guard, chip, review } = setup();
    await guard.ready;
    const prompt = /** @type {HTMLTextAreaElement} */ (mount(`<textarea id="prompt-textarea"></textarea>`));
    paste(prompt, "Mail jane.smith@example.com");
    prompt.value = "";
    review.render();
    expect(/** @type {HTMLElement} */ (chip().querySelector(".chip")).hidden).toBe(true);
  });
});

describe("copying replies", () => {
  it("fills real values into copied reply text, but not text copied from the prompt", async () => {
    const { guard, notices } = setup();
    await guard.ready;
    const prompt = /** @type {HTMLTextAreaElement} */ (mount(`<textarea id="prompt-textarea"></textarea>`));
    paste(prompt, "Write to Dr. Jane Smith at jane.smith@example.com.");
    const reply = mount(`<div data-message-author-role="assistant"><p>Dear [[PERSON_1]], I will email [[EMAIL_1]].</p></div>`);

    const selection = /** @type {Selection} */ (document.getSelection());
    selection.selectAllChildren(reply);
    /** @type {Record<string, string>} */
    const written = {};
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData: (/** @type {string} */ type, /** @type {string} */ value) => { written[type] = value; } } });
    reply.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(written["text/plain"]).toBe("Dear Jane Smith, I will email jane.smith@example.com.");
    expect(notices.at(-1)).toMatch(/copied with 2 real values/);
  });

  it("offers the newest reply with real values once replies contain placeholders", async () => {
    const { guard, replies, chip } = setup();
    await guard.ready;
    const prompt = /** @type {HTMLTextAreaElement} */ (mount(`<textarea id="prompt-textarea"></textarea>`));
    paste(prompt, "Mail jane.smith@example.com");
    mount(`<div data-message-author-role="assistant">Old reply</div>`);
    mount(`<div data-message-author-role="assistant">I wrote to [[EMAIL_1]].</div>`);
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(replies.count()).toBe(1);
    expect(replies.lastReplyText()).toBe("I wrote to jane.smith@example.com.");
    expect(/** @type {HTMLElement} */ (chip().querySelector(".copy")).hidden).toBe(false);
  });
});
