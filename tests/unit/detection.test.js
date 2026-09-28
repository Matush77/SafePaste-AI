// Behaviour of individual detection rules: what must be redacted, and what
// must survive untouched. The evaluation corpus measures overall quality;
// these pin down specific decisions so they do not regress silently.
import { describe, expect, it } from "vitest";
import { mergeSettings, redact } from "../../src/redactor.js";

/**
 * @param {string} text
 * @param {{ gone?: string[], kept?: string[], settings?: object }} expectations
 */
function check(text, { gone = [], kept = [], settings } = {}) {
  const output = redact(text, settings).text;
  for (const value of gone) {
    expect(output, `"${value}" should be redacted in:\n${output}`).not.toContain(value);
  }
  for (const value of kept) {
    expect(output, `"${value}" should be kept in:\n${output}`).toContain(value);
  }
}

describe("secrets", () => {
  it("redacts whole tokens, including their prefix", () => {
    check("glpat-x7Kq2mZp9Lw4Rt8Vy3Nb and npm_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8 and 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", {
      gone: ["glpat", "x7Kq2mZp", "npm_", "a1B2c3", "hf_", "QwErTy"]
    });
  });

  it("labels Anthropic keys as Anthropic keys", () => {
    expect(redact("sk-ant-api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBa-9aZ8bY7cX6dW5").text).toBe("[[ANTHROPIC_API_KEY_1]]");
  });

  it("redacts quoted JSON and YAML secrets but not their keys", () => {
    check('{"password": "hunter2-Prod!", "apiKey": "4c1f9e27b8d3a6f0e5c2"}\npassword: xK9#mP2$vL7q', {
      gone: ["hunter2-Prod!", "4c1f9e27b8d3a6f0e5c2", "xK9#mP2$vL7q"],
      kept: ['"password":', '"apiKey":', "password:"]
    });
  });

  it("leaves code that references secrets alone", () => {
    const code = [
      "const token = getToken();",
      "const password = form.password.value;",
      'API_KEY = os.environ["API_KEY"]',
      "secret = settings.SECRET_KEY",
      "client = Client(api_key=API_KEY, password=DB_PASSWORD)",
      "accessToken: string;",
      "password_hash = hash(password)"
    ].join("\n");
    expect(redact(code).text).toBe(code);
  });

  it("leaves documentation placeholders alone", () => {
    const text = "OPENAI_API_KEY=<your-openai-key>\nSTRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxx\nJWT_SECRET=change-me\npassword: ********";
    expect(redact(text).text).toBe(text);
  });

  it("redacts only the password in connection strings, even with @ and # inside it", () => {
    check("postgres://admin:S3cretP@ss@db.prod.internal:5432/orders", { gone: ["S3cretP@ss"], kept: ["postgres://admin:", "5432/orders"] });
    check("https://deploy:Summer#2025@jenkins.example.net/job/release", { gone: ["Summer#2025"] });
    check("Server=tcp:x.database.windows.net;User ID=sa;Password=Pa$$w0rd!2024;", { gone: ["Pa$$w0rd!2024"], kept: ["User ID=sa"] });
  });

  it("redacts URLs whose query carries a secret, but not ordinary links", () => {
    check("Reset: https://shop.example.com/reset?token=b7e1c9d2f3a4e5b6", { gone: ["b7e1c9d2f3a4e5b6"] });
    check("Docs: https://docs.python.org/3/library/os.html#os.path.join and https://github.com/facebook/react/issues/1", {
      kept: ["https://docs.python.org/3/library/os.html#os.path.join", "https://github.com/facebook/react/issues/1"]
    });
  });

  it("redacts private keys, including ones cut off before the END line", () => {
    check("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA3Tz2mr7SZiAMfQyuvBjM9Oi7SFlMBVtKxYbqkHiG5k0Wq3Xn\n(rest cut off)", {
      gone: ["MIIEpAIBAAKCAQEA3Tz2mr7SZiAMfQyuvBjM9Oi7"],
      kept: ["(rest cut off)"]
    });
  });

  it("redacts passwords stated in prose", () => {
    check("The wifi password is kiwi4471 and the vault password is \"correct horse battery staple\".", {
      gone: ["kiwi4471", "correct horse battery staple"],
      kept: ["The wifi password is"]
    });
    check("Password is required", { kept: ["Password is required"] });
  });
});

describe("contact details", () => {
  it("finds international and national phone formats", () => {
    check("+421 905 123 456, 0905 987 654, 020 7946 0958, (614) 555-0187, 415.555.0133, +44 7700 900123", {
      gone: ["905 123 456", "0905 987 654", "020 7946 0958", "555-0187", "555.0133", "7700 900123"]
    });
  });

  it("does not treat order numbers, timestamps, SKUs or UUIDs as phones", () => {
    const text = "Order 1234567890, epoch 1700000000000, SKU 400-221-9087, id 550e8400-e29b-41d4-a716-446655440000, tz +0100";
    expect(redact(text).text).toBe(text);
  });

  it("finds Unicode and obfuscated email addresses", () => {
    check("jürgen.weiß@müller-bau.de or sarah dot kim at protonmail dot com", { gone: ["jürgen", "müller-bau", "sarah dot kim", "protonmail"] });
  });
});

describe("financial and government IDs", () => {
  it("validates card numbers and IBANs", () => {
    check("card 4111 1111 1111 1111, IBAN SK31 1200 0000 1987 4263 7541", { gone: ["4111 1111 1111 1111", "SK31 1200"] });
    // Luhn-valid but no real issuer prefix; IBAN with a wrong checksum.
    check("ref 1234567812345670, iban SK31 1200 0000 1987 4263 7540", { kept: ["1234567812345670", "SK31 1200 0000 1987 4263 7540"] });
  });

  it("validates SSNs, UK NI numbers and Czech/Slovak birth numbers", () => {
    check("SSN 457-55-5462, NI number QQ 12 34 56 C, rodné číslo 851203/4417", { gone: ["457-55-5462", "QQ 12 34 56 C", "851203/4417"] });
    check("Serial 000-12-3456 and 666-12-3456", { kept: ["000-12-3456", "666-12-3456"] });
  });

  it("finds dates of birth written in words", () => {
    check("her date of birth is March 3, 1985 and his DOB 1978-06-21", { gone: ["March 3, 1985", "1978-06-21"] });
    check("The release is on March 3, 1985.", { kept: ["March 3, 1985"] });
  });
});

describe("network", () => {
  it("redacts real addresses but not localhost, masks, CIDR examples or clock times", () => {
    check("upstream http://10.12.4.31:8080 and 2001:db8:85a3::8a2e:370:7334, ether 3c:22:fb:9a:41:0e", {
      gone: ["10.12.4.31", "2001:db8:85a3", "3c:22:fb:9a:41:0e"]
    });
    const benign = "listen 0.0.0.0 and 127.0.0.1, subnet 10.0.0.0/16, mask 255.255.255.0, at 10:30:45:12:00:11 and 2025:10:14:22";
    expect(redact(benign).text).toBe(benign);
  });

  it("redacts internal URLs but not public sites", () => {
    check("See https://wiki.corp.novacart.io/ops/runbook and https://dev.to/some-post", {
      gone: ["wiki.corp.novacart.io"],
      kept: ["https://dev.to/some-post"]
    });
  });
});

describe("people, organisations and places", () => {
  it("finds names from titles, greetings, sign-offs, labels and introductions", () => {
    check("Dear Anneke,\nThanks, Rebecca\nAttendees: Chiara Bianchi, Kwame Mensah\nMy name is Tomáš Kováčik.\nKind regards,\nIngrid Solberg", {
      gone: ["Anneke", "Rebecca", "Chiara Bianchi", "Kwame Mensah", "Tomáš Kováčik", "Ingrid Solberg"]
    });
    check("Dr. Jane Smith called", { gone: ["Jane Smith"], kept: ["Dr."] });
  });

  it("does not turn headings or ordinary sentences into names", () => {
    const text = "Machine Learning Model Deployment Best Practices\nI'm planning a two-week trip.\nContact list for the event\nThis is Big Data Analytics.";
    expect(redact(text).text).toBe(text);
  });

  it("redacts place and institution names only next to other personal data", () => {
    const general = "From New York to Paris, then Berlin. Harvard University and the European Central Bank.";
    expect(redact(general).text).toBe(general);
    check("Destination is Singapore and the contact email is priya.shah@example.net.", { gone: ["Singapore"] });
    check("Beneficiary Liam Johnson banks with North Star Bank.", { gone: ["North Star Bank"] });
  });

  it("redacts a place tied to a person by context", () => {
    check("Dmitri is relocating from Tallinn to our Lisbon office.", { gone: ["Tallinn", "Lisbon"] });
  });

  it("reads personal data by field name in JSON and CSV", () => {
    check('{"name": "Luis Ortega", "city": "Valencia", "phone": "+34 612 345 678"}', { gone: ["Luis Ortega", "Valencia", "612 345 678"] });
    check("id,name,email\n1,Hannah Schmidt,hannah@web.de", { gone: ["Hannah Schmidt", "hannah@web.de"], kept: ["id,name,email"] });
    check('{"name": "checkout-web", "version": "4.12.3"}', { kept: ["checkout-web"] });
  });
});

describe("overlaps and settings", () => {
  it("merges overlapping matches so no fragment leaks", () => {
    const { text, findings } = redact("Contact 4417 Maple Ridge Dr, Columbus, OH 43215 today");
    expect(text).toBe("Contact [[ADDRESS_1]] today");
    expect(findings).toHaveLength(1);
  });

  it("only redacts low-confidence matches in strict mode", () => {
    // Fits the US EIN format, but nothing nearby says it is a tax ID.
    const text = "Batch 12-3456789 shipped on time.";
    expect(redact(text).text).toBe(text);
    expect(redact(text, { sensitivity: "strict" }).text).not.toContain("12-3456789");
  });

  it("respects disabled categories", () => {
    const settings = mergeSettings({ categories: { ...mergeSettings().categories, people: false } });
    check("Dear Anneke, mail anneke@example.com", { settings, kept: ["Anneke,"], gone: ["anneke@example.com"] });
  });
});
