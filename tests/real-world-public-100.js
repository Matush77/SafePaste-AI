const assert = require("node:assert/strict");

global.window = global;
require("../src/redactor.js");

const settings = global.SensitivePasteRedactor.mergeSettings({
  categories: {
    urls: true
  }
});

const sources = [
  {
    id: "purdue_contact",
    url: "https://www.purdue.edu/home/contact-us/",
    text: [
      "Purdue University",
      "610 Purdue Mall",
      "West Lafayette, IN 47907",
      "Main University Phone 765-494-4600",
      "Undergraduate Admissions 765-494-1776 admissions@purdue.edu",
      "Graduate Admissions 765-494-2600 gradinfo@purdue.edu",
      "International Students & Scholars 765-494-5770 iss@purdue.edu",
      "Financial Aid 765-494-5050 facontact@purdue.edu",
      "University Residences 765-494-1000 newres@purdue.edu",
      "Parking 765-494-9497 parking@purdue.edu",
      "Purdue Brand Studio 765-494-2034 marketing@purdue.edu",
      "University Website 765-494-4600 online@purdue.edu",
      "Accessibility 765-494-7255 equity@purdue.edu",
      "Human Resources 765-494-2222 hr@purdue.edu",
      "Campus Safety 765-494-8221",
      "News Service 765-494-2096 purduenews@purdue.edu",
      "Welcome Center 765-494-4636 welcomecenter@purdue.edu",
      "Tech Support 765-494-4000 it@purdue.edu",
      "ID Card Operations 765-494-7570 askbursar@purdue.edu"
    ].join("\n"),
    sensitive: [
      "610 Purdue Mall",
      "West Lafayette, IN 47907",
      "765-494-4600",
      "765-494-1776",
      "admissions@purdue.edu",
      "765-494-2600",
      "gradinfo@purdue.edu",
      "765-494-5770",
      "iss@purdue.edu",
      "765-494-5050",
      "facontact@purdue.edu",
      "765-494-1000",
      "newres@purdue.edu",
      "765-494-9497",
      "parking@purdue.edu",
      "765-494-2034",
      "marketing@purdue.edu",
      "online@purdue.edu",
      "765-494-7255",
      "equity@purdue.edu",
      "765-494-2222",
      "hr@purdue.edu",
      "765-494-8221",
      "765-494-2096",
      "purduenews@purdue.edu",
      "765-494-4636",
      "welcomecenter@purdue.edu",
      "765-494-4000",
      "it@purdue.edu",
      "765-494-7570",
      "askbursar@purdue.edu"
    ]
  },
  {
    id: "northwestu_contact",
    url: "https://www.northwestu.edu/about/contact",
    text: [
      "Northwest University",
      "5520 108th Ave. N.E.",
      "Kirkland, WA 98033",
      "Email: info@northwestu.edu",
      "General: 425-822-8266",
      "Admissions: 1-800-669-3781",
      "P.O. Box 579",
      "Kirkland, WA 98083-0579",
      "Academic Success and Advising 425-889-5227 advising@northwestu.edu",
      "Campus Ministries 425-889-5308 campusministries@northwestu.edu",
      "Career Services 425-889-5208 careerservices@northwestu.edu",
      "Center for Online and Extended Education 425-889-7793 coee-department@northwestu.edu",
      "Housing 425-889-5334 housing@northwestu.edu",
      "International Student Services 425-889-6280 international@northwestu.edu",
      "Main Campus 425-822-8266 info@northwestu.edu",
      "Parent Relations 425-889-6321 parents@northwestu.edu",
      "President's Office 425-889-6376 president@northwestu.edu",
      "Provost's Office 425-889-5237 provost@northwestu.edu",
      "Registrar 425-889-5228 registrarsoffice@northwestu.edu",
      "Security 425-864-1552 security@northwestu.edu",
      "Student Development 425-889-5234 studentdevelopment@northwestu.edu",
      "Student Financial Services 425-889-5210 studentfinancialservices@northwestu.edu",
      "Traditional Enrollment 425-889-5231 admissions@northwestu.edu"
    ].join("\n"),
    sensitive: [
      "5520 108th Ave. N.E.",
      "Kirkland, WA 98033",
      "info@northwestu.edu",
      "425-822-8266",
      "1-800-669-3781",
      "P.O. Box 579",
      "Kirkland, WA 98083-0579",
      "425-889-5227",
      "advising@northwestu.edu",
      "425-889-5308",
      "campusministries@northwestu.edu",
      "425-889-5208",
      "careerservices@northwestu.edu",
      "425-889-7793",
      "coee-department@northwestu.edu",
      "425-889-5334",
      "housing@northwestu.edu",
      "425-889-6280",
      "international@northwestu.edu",
      "425-889-6321",
      "parents@northwestu.edu",
      "425-889-6376",
      "president@northwestu.edu",
      "425-889-5237",
      "provost@northwestu.edu",
      "425-889-5228",
      "registrarsoffice@northwestu.edu",
      "425-864-1552",
      "security@northwestu.edu",
      "425-889-5234",
      "studentdevelopment@northwestu.edu",
      "425-889-5210",
      "studentfinancialservices@northwestu.edu",
      "425-889-5231"
    ]
  },
  {
    id: "claflin_contact",
    url: "https://www.claflin.edu/about/contact-us",
    text: [
      "Claflin University",
      "400 Magnolia Street",
      "Orangeburg, SC 29115",
      "Local Phone Number: (803) 535-5000",
      "Admissions 1-800-922-1276 admissions@claflin.edu",
      "Alumni Relations (803) 535-5348",
      "Communications & Marketing (803) 535-5350",
      "Financial Aid (803) 535-5334 Fax: (803) 535-5383 finaid@claflin.edu",
      "Fiscal Affairs (803) 535-5197",
      "Giving to Claflin (803) 535-5238",
      "Human Resources (803) 535-5268",
      "Information & Technology Services (803) 535-5441 helpdesk@claflin.edu",
      "Library (803) 535-5309",
      "Public Safety (803) 535-5444",
      "Student Services (803) 535-5341"
    ].join("\n"),
    sensitive: [
      "400 Magnolia Street",
      "Orangeburg, SC 29115",
      "(803) 535-5000",
      "1-800-922-1276",
      "admissions@claflin.edu",
      "(803) 535-5348",
      "(803) 535-5350",
      "(803) 535-5334",
      "(803) 535-5383",
      "finaid@claflin.edu",
      "(803) 535-5197",
      "(803) 535-5238",
      "(803) 535-5268",
      "(803) 535-5441",
      "helpdesk@claflin.edu",
      "(803) 535-5309",
      "(803) 535-5444",
      "(803) 535-5341"
    ]
  },
  {
    id: "lehigh_contact",
    url: "https://www2.lehigh.edu/about/contact-lehigh",
    text: [
      "Lehigh University",
      "27 Memorial Drive West",
      "Bethlehem, PA 18015 USA",
      "Phone: (610) 758-3000",
      "Undergraduate Admissions Phone: (610) 758-3100 Fax: (610) 758-4361 Email: admissions@lehigh.edu",
      "Transfer Students transfers@lehigh.edu",
      "International Students luinternational@lehigh.edu",
      "College of Arts and Sciences Phone: (610) 758-4280",
      "College of Business Phone: (610) 758-4450",
      "College of Education Phone: (610) 758-3231",
      "College of Health Phone: (610) 758-1800",
      "P.C. Rossin College of Engineering & Applied Science Phone: (610) 758-6310",
      "Alumni Phone: (866) 758-2586 Email: alumnirelations@lehigh.edu",
      "Bursar Phone: (610) 758-3160 Email: bursar@lehigh.edu",
      "Financial Aid Phone: (610) 758-3181 Email: financialaid@lehigh.edu",
      "Help Desk Phone: (610) 758-4357 Email: helpdesk@lehigh.edu Website Feedback: inis@lehigh.edu",
      "Housing Phone: (610) 758-3500 Email: inhouse@lehigh.edu",
      "Human Resources Phone: (610) 758-3900 Email: inhro@lehigh.edu",
      "Office of the President Phone: (610) 758-3157 Fax: (610) 758-3154 Email: pres@lehigh.edu",
      "Registration & Academic Services Phone: (610) 758-3200 Email: ras@lehigh.edu",
      "Strategic Planning Phone: (610) 758-3813 Email: inspi@lehigh.edu",
      "Summer Sessions Email: summer@lehigh.edu"
    ].join("\n"),
    sensitive: [
      "27 Memorial Drive West",
      "Bethlehem, PA 18015",
      "(610) 758-3000",
      "(610) 758-3100",
      "(610) 758-4361",
      "admissions@lehigh.edu",
      "transfers@lehigh.edu",
      "luinternational@lehigh.edu",
      "(610) 758-4280",
      "(610) 758-4450",
      "(610) 758-3231",
      "(610) 758-1800",
      "(610) 758-6310",
      "(866) 758-2586",
      "alumnirelations@lehigh.edu",
      "(610) 758-3160",
      "bursar@lehigh.edu",
      "(610) 758-3181",
      "financialaid@lehigh.edu",
      "(610) 758-4357",
      "helpdesk@lehigh.edu",
      "inis@lehigh.edu",
      "(610) 758-3500",
      "inhouse@lehigh.edu",
      "(610) 758-3900",
      "inhro@lehigh.edu",
      "(610) 758-3157",
      "(610) 758-3154",
      "pres@lehigh.edu",
      "(610) 758-3200",
      "ras@lehigh.edu",
      "(610) 758-3813",
      "inspi@lehigh.edu",
      "summer@lehigh.edu"
    ]
  },
  {
    id: "phone_com_contact",
    url: "https://www.phone.com/contact-us/",
    text: [
      "Phone.com Sales (877) 746-6310",
      "Newark, NJ Headquarters",
      "625 Mayor Kenneth A. Gibson Boulevard, Suite 240",
      "Newark, NJ 07102",
      "New York, NY",
      "Empire State Building",
      "350 5th Avenue, Suite 4215",
      "New York, NY 10118",
      "Poway, CA",
      "14288 Danielson Street, Suite 100",
      "Poway, CA 92064",
      "General inquiries 877-PHONE-10 (877-746-6310)",
      "Mailing Address 184 So. Livingston Ave. Suite # 9-222",
      "Livingston, NJ 07039",
      "Payment Processing Phone.Com Inc PO BOX 8001 Carol Stream, IL 60197-8001"
    ].join("\n"),
    sensitive: [
      "(877) 746-6310",
      "625 Mayor Kenneth A. Gibson Boulevard, Suite 240",
      "Newark, NJ 07102",
      "350 5th Avenue, Suite 4215",
      "New York, NY 10118",
      "14288 Danielson Street, Suite 100",
      "Poway, CA 92064",
      "877-PHONE-10",
      "184 So. Livingston Ave. Suite # 9-222",
      "Livingston, NJ 07039",
      "Phone.Com Inc",
      "PO BOX 8001",
      "Carol Stream, IL 60197-8001"
    ]
  }
];

const scenarios = sources.map((source) => ({
  id: source.id,
  source: source.url,
  text: `Source: ${source.url}\n${source.text}`,
  sensitive: Array.from(new Set(source.sensitive))
}));

const expectedCount = scenarios.reduce((total, scenario) => total + scenario.sensitive.length, 0);
assert.ok(expectedCount >= 100, `Expected at least 100 real public values, got ${expectedCount}`);

const results = scenarios.map((scenario) => {
  const result = global.SensitivePasteRedactor.redact(scenario.text, settings);
  const leaked = scenario.sensitive.filter((value) => result.text.includes(value));
  return {
    id: scenario.id,
    source: scenario.source,
    total: scenario.sensitive.length,
    redacted: scenario.sensitive.length - leaked.length,
    leaked
  };
});

const totals = results.reduce((acc, result) => {
  acc.items += result.total;
  acc.redacted += result.redacted;
  acc.sources += 1;
  if (result.leaked.length === 0) {
    acc.fullPass += 1;
  }
  return acc;
}, { sources: 0, fullPass: 0, items: 0, redacted: 0 });

const missed = results.filter((result) => result.leaked.length > 0);
const itemPercent = ((totals.redacted / totals.items) * 100).toFixed(1);
const sourcePercent = ((totals.fullPass / totals.sources) * 100).toFixed(1);

console.log("Real-world public contact benchmark");
console.log(`Sources fully redacted: ${totals.fullPass}/${totals.sources} (${sourcePercent}%)`);
console.log(`Public contact values redacted: ${totals.redacted}/${totals.items} (${itemPercent}%)`);

if (missed.length) {
  console.log("\nMisses:");
  for (const result of missed) {
    console.log(`- ${result.id} (${result.source}): missed ${result.leaked.join(" | ")}`);
  }
}

module.exports = { sources, scenarios, results, totals };
