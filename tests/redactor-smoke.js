const assert = require("node:assert/strict");

global.window = global;
require("../src/redactor.js");

const input = [
  "Hi Dr. Jane Smith,",
  "email jane.smith@example.com",
  "phone +1 415-555-0199",
  "card 4111 1111 1111 1111",
  "key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
  "company Acme Labs Inc.",
  "address 123 Market Street"
].join(", ");

const result = global.SensitivePasteRedactor.redact(input);

assert.equal(result.changed, true);
assert.match(result.text, /\[\[PERSON_1\]\]/);
assert.match(result.text, /\[\[EMAIL_1\]\]/);
assert.match(result.text, /\[\[PHONE_1\]\]/);
assert.match(result.text, /\[\[CREDIT_CARD_1\]\]/);
assert.match(result.text, /\[\[OPENAI_API_KEY_1\]\]/);
assert.match(result.text, /\[\[ORG_1\]\]/);
assert.match(result.text, /\[\[ADDRESS_1\]\]/);
assert.doesNotMatch(result.text, /Jane Smith/);
assert.doesNotMatch(result.text, /jane\.smith@example\.com/);

console.log("Redactor smoke test passed.");
