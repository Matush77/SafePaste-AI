const assert = require("node:assert/strict");

global.window = global;
require("../src/redactor.js");

const input = `Contact Us
We have support articles tackling common questions and concerns. We also have a dedicated support team available to help with any other questions you may have. Email, call or submit a support ticket to get your questions answered.

Phone Icon
+1 (855) 234-5020
Monday - Friday, 9AM - 6PM EST
Address Icon
906 W 2ND AVE, STE 100
SPOKANE, WA 99201-4540, United States
Chat icon
Chat with us
Monday - Friday, 9AM - 6PM EST
Email icon
Email Us
Use the form below to submit your question`;

const result = global.SensitivePasteRedactor.redact(input);
const types = result.findings.map((finding) => finding.type);

assert.equal(result.text.includes("+1 (855) 234-5020"), false);
assert.equal(result.text.includes("906 W 2ND AVE, STE 100"), false);
assert.equal(result.text.includes("SPOKANE, WA 99201-4540"), false);
assert.ok(types.includes("PHONE"));
assert.ok(types.filter((type) => type === "ADDRESS").length >= 2);

console.log("Contact block test passed.");
