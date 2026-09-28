const assert = require("node:assert/strict");

global.window = global;
require("../src/redactor.js");

const settings = global.SensitivePasteRedactor.mergeSettings({
  categories: {
    urls: true
  }
});

const samples = [
  {
    id: "hhs-headquarters",
    text: [
      "The U.S. Department of Health & Human Services",
      "Hubert H. Humphrey Building",
      "200 Independence Avenue, S.W.",
      "Washington, D.C. 20201",
      "Toll Free Call Center: 1-877-696-6775"
    ].join("\n"),
    sensitive: ["200 Independence Avenue, S.W.", "Washington, D.C. 20201", "1-877-696-6775"]
  },
  {
    id: "fmc-corporate",
    text: [
      "FMC Corporate Headquarters",
      "2929 Walnut Street",
      "Philadelphia, PA 19104, USA",
      "+1 215 299-6000",
      "Media contact Kaitlin O'Shaughnessy",
      "+1 215-299-6405",
      "kaitlin.oshaughnessy@fmc.com"
    ].join("\n"),
    sensitive: [
      "2929 Walnut Street",
      "Philadelphia, PA 19104",
      "+1 215 299-6000",
      "+1 215-299-6405",
      "kaitlin.oshaughnessy@fmc.com"
    ]
  },
  {
    id: "humanity-inclusion",
    text: [
      "Humanity & Inclusion U.S.",
      "8757 Georgia Avenue",
      "Suite 420",
      "Silver Spring, MD 20910",
      "+1 (301) 891-2138",
      "+1 (301) 891-9193",
      "Humanity & Inclusion is a nonprofit 501(c)(3) organization (EIN/tax ID number: 55-0914744)."
    ].join("\n"),
    sensitive: [
      "8757 Georgia Avenue",
      "Silver Spring, MD 20910",
      "+1 (301) 891-2138",
      "+1 (301) 891-9193",
      "55-0914744"
    ]
  },
  {
    id: "sios-headquarters",
    text: [
      "SIOS Technology Corp.",
      "4 West 4th Avenue",
      "San Mateo, CA 94402",
      "Toll-Free (US): 866.318.0108",
      "Main: +1.650.645.7000",
      "Fax: +1.650.645.7030",
      "Email: info@us.sios.com"
    ].join("\n"),
    sensitive: [
      "4 West 4th Avenue",
      "San Mateo, CA 94402",
      "866.318.0108",
      "+1.650.645.7000",
      "info@us.sios.com"
    ]
  },
  {
    id: "sios-columbia",
    text: [
      "SIOS Technology Corp.",
      "550 Assembly St, Ste. 400",
      "Columbia, SC 29201",
      "Tel: +1 866.318.0108"
    ].join("\n"),
    sensitive: ["550 Assembly St, Ste. 400", "Columbia, SC 29201", "+1 866.318.0108"],
    fragments: ["Ste. 400"]
  },
  {
    id: "bellingham-city-hall",
    text: [
      "City Hall",
      "210 Lottie Street",
      "Bellingham, WA 98225",
      "+1 (360) 778-8000",
      "info@cob.org"
    ].join("\n"),
    sensitive: ["210 Lottie Street", "Bellingham, WA 98225", "+1 (360) 778-8000", "info@cob.org"]
  },
  {
    id: "unidosus-headquarters",
    text: [
      "Headquarters",
      "1126 16th St NW #600",
      "Washington, DC 20036",
      "Phone: (202) 785-1670"
    ].join("\n"),
    sensitive: ["1126 16th St NW #600", "Washington, DC 20036", "(202) 785-1670"],
    fragments: ["NW #600", "#600"]
  },
  {
    id: "gilead-general",
    text: [
      "Our corporate headquarters is in Foster City, California.",
      "333 Lakeside Drive",
      "Foster City, CA 94404",
      "Gilead: public_affairs@gilead.com",
      "Phone: +1 (650) 574 3000",
      "Fax: (650) 522-5853"
    ].join("\n"),
    sensitive: [
      "333 Lakeside Drive",
      "Foster City, CA 94404",
      "public_affairs@gilead.com",
      "+1 (650) 574 3000",
      "(650) 522-5853"
    ]
  },
  {
    id: "amgen-investor",
    text: [
      "Investor Relations",
      "+1 805-447-1060",
      "investor.relations@amgen.com",
      "For medical information: +1 800-867-6677",
      "Privacy Office: +1 805-313-5151",
      "privacy@amgen.com"
    ].join("\n"),
    sensitive: [
      "+1 805-447-1060",
      "investor.relations@amgen.com",
      "+1 800-867-6677",
      "+1 805-313-5151",
      "privacy@amgen.com"
    ]
  },
  {
    id: "callback-technologies",
    text: [
      "Billing & Order Inquiries",
      "(800) 340-9313 (within US)",
      "(919) 797-9909 (outside US)",
      "sales@callback.com",
      "Corporate Headquarters",
      "101 Europa Dr., Suite 150",
      "Chapel Hill, NC 27517, USA",
      "Fax: (919) 617-0515",
      "info@callback.com"
    ].join("\n"),
    sensitive: [
      "(800) 340-9313",
      "(919) 797-9909",
      "sales@callback.com",
      "101 Europa Dr., Suite 150",
      "Chapel Hill, NC 27517",
      "(919) 617-0515",
      "info@callback.com"
    ],
    fragments: ["Suite 150"]
  }
];

let total = 0;
let redacted = 0;

for (const sample of samples) {
  const result = global.SensitivePasteRedactor.redact(sample.text, settings);
  const leaked = sample.sensitive.filter((value) => result.text.includes(value));
  const leakedFragments = (sample.fragments || []).filter((value) => result.text.includes(value));

  total += sample.sensitive.length;
  redacted += sample.sensitive.length - leaked.length;

  assert.deepEqual(leaked, [], `${sample.id} leaked sensitive values`);
  assert.deepEqual(leakedFragments, [], `${sample.id} leaked address fragments`);
}

const percent = ((redacted / total) * 100).toFixed(1);
assert.equal(redacted, total, `Public contact sample score ${redacted}/${total} (${percent}%)`);

console.log(`Public contact sample test passed: ${redacted}/${total} (${percent}%).`);
