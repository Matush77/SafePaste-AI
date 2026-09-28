const assert = require("node:assert/strict");

const scenarios = require("./paste-scenarios.js");

global.window = global;
require("../src/redactor.js");

const settings = global.SensitivePasteRedactor.mergeSettings({
  categories: {
    urls: true
  }
});

assert.equal(scenarios.length, 20, "Expected exactly 20 paste scenarios");

for (const scenario of scenarios) {
  const result = global.SensitivePasteRedactor.redact(scenario.text, settings);
  const types = new Set(result.findings.map((finding) => finding.type));
  const missingTypes = scenario.expect.filter((type) => !types.has(type));
  const leakedValues = scenario.sensitive.filter((value) => result.text.includes(value));

  assert.deepEqual(missingTypes, [], `${scenario.id} missed expected entity types`);
  assert.deepEqual(leakedValues, [], `${scenario.id} leaked sensitive values`);
  assert.equal(result.changed, scenario.expect.length > 0, `${scenario.id} changed state mismatch`);
}

console.log(`Redactor scenario test passed for ${scenarios.length} scenarios.`);
