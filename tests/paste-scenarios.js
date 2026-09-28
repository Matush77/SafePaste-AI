(function (root) {
  "use strict";

  const scenarios = [
    {
      id: "credentials",
      title: "Credential dump",
      expect: ["OPENAI_API_KEY", "GITHUB_TOKEN", "SECRET", "EMAIL"],
      sensitive: ["sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890", "ghp_abcdefghijklmnopqrstuvwxyz1234567890", "hunter2!", "admin@example.com"],
      text: [
        "Please debug this production auth config:",
        "OPENAI_API_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
        "github_token: ghp_abcdefghijklmnopqrstuvwxyz1234567890",
        "password=hunter2!",
        "Owner email: admin@example.com"
      ].join("\n")
    },
    {
      id: "customer-support-pii",
      title: "Customer-support PII",
      expect: ["PERSON", "EMAIL", "PHONE", "ADDRESS", "LOCATION"],
      sensitive: ["Dr. Jane Smith", "jane.smith@example.com", "+1 415-555-0199", "123 Market Street", "San Francisco, CA"],
      text: [
        "Summarize this customer complaint from Dr. Jane Smith.",
        "Contact jane.smith@example.com or +1 415-555-0199.",
        "Shipping address is 123 Market Street, San Francisco, CA."
      ].join("\n")
    },
    {
      id: "finance-reimbursement",
      title: "Finance reimbursement",
      expect: ["ORG", "CREDIT_CARD", "IBAN"],
      sensitive: ["Acme Labs Inc.", "4111 1111 1111 1111", "DE89370400440532013000"],
      text: [
        "Categorize this reimbursement for Acme Labs Inc.",
        "Corporate card: 4111 1111 1111 1111.",
        "Vendor IBAN: DE89370400440532013000."
      ].join("\n")
    },
    {
      id: "infrastructure-log",
      title: "Infrastructure log",
      expect: ["AWS_ACCESS_KEY", "IP_ADDRESS", "MAC_ADDRESS", "JWT"],
      sensitive: ["AKIAIOSFODNN7EXAMPLE", "192.168.10.44", "00:1A:2B:3C:4D:5E", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"],
      text: [
        "Explain this failed deploy log.",
        "AWS key AKIAIOSFODNN7EXAMPLE called from 192.168.10.44.",
        "Device 00:1A:2B:3C:4D:5E sent bearer token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c."
      ].join("\n")
    },
    {
      id: "healthcare-note",
      title: "Healthcare note",
      expect: ["PERSON", "SSN", "LOCATION", "EMAIL"],
      sensitive: ["Maria Garcia", "123-45-6789", "Prague", "maria.garcia@example.org"],
      text: [
        "Extract tasks from this intake note.",
        "Patient Maria Garcia has SSN 123-45-6789 and lives in Prague.",
        "Follow up at maria.garcia@example.org."
      ].join("\n")
    },
    {
      id: "hr-onboarding",
      title: "HR onboarding",
      expect: ["PERSON", "TAX_ID", "DRIVER_LICENSE", "PHONE"],
      sensitive: ["Noah Williams", "EIN: 12-3456789", "driver license D12345678", "(212) 555-0123"],
      text: [
        "Prepare an onboarding checklist for employee Noah Williams.",
        "The contractor record lists EIN: 12-3456789 and driver license D12345678.",
        "Call (212) 555-0123 if payroll needs confirmation."
      ].join("\n")
    },
    {
      id: "travel-itinerary",
      title: "Travel itinerary",
      expect: ["PERSON", "PASSPORT", "LOCATION", "EMAIL"],
      sensitive: ["Priya Shah", "passport number P12345678", "Singapore", "priya.shah@example.net"],
      text: [
        "Create a concise trip plan for Priya Shah.",
        "Her passport number P12345678 is in the booking notes.",
        "Destination is Singapore and the contact email is priya.shah@example.net."
      ].join("\n")
    },
    {
      id: "stripe-webhook",
      title: "Stripe webhook config",
      expect: ["STRIPE_SECRET_KEY", "SECRET", "URL"],
      sensitive: ["sk_live_abcdefghijklmnopqrstuvwxyz123456", "whsec_1234567890abcdef", "https://billing.example.com/webhooks/stripe"],
      text: [
        "Review this webhook setup before deployment.",
        "STRIPE_SECRET_KEY=sk_live_abcdefghijklmnopqrstuvwxyz123456",
        "webhook_secret=whsec_1234567890abcdef",
        "Endpoint: https://billing.example.com/webhooks/stripe"
      ].join("\n")
    },
    {
      id: "google-maps-config",
      title: "Google Maps config",
      expect: ["GOOGLE_API_KEY", "URL", "LOCATION"],
      sensitive: ["AIzaSyA1234567890abcdefghijklmnopqrstuv", "https://maps.example.com/internal", "Berlin"],
      text: [
        "Help debug map loading in Berlin.",
        "Google key: AIzaSyA1234567890abcdefghijklmnopqrstuv",
        "Internal page: https://maps.example.com/internal"
      ].join("\n")
    },
    {
      id: "slack-incident",
      title: "Slack incident",
      expect: ["SLACK_TOKEN", "IP_ADDRESS", "URL"],
      sensitive: ["xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx", "10.0.4.22", "https://status.example.com/incidents/42"],
      text: [
        "Draft an incident update for the on-call team.",
        "Slack bot token xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx posted from 10.0.4.22.",
        "Status page: https://status.example.com/incidents/42"
      ].join("\n")
    },
    {
      id: "bank-transfer",
      title: "Bank transfer",
      expect: ["PERSON", "ORG", "BANK_ACCOUNT", "ROUTING_NUMBER"],
      sensitive: ["Liam Johnson", "North Star Bank", "account number 123456789012", "routing number 021000021"],
      text: [
        "Summarize the wire transfer request for Liam Johnson.",
        "Beneficiary bank is North Star Bank.",
        "Use account number 123456789012 and routing number 021000021."
      ].join("\n")
    },
    {
      id: "sales-crm",
      title: "Sales CRM note",
      expect: ["PERSON", "ORG", "EMAIL", "PHONE"],
      sensitive: ["Chloe Brown", "Nimbus Corporation", "chloe.brown@nimbus.example", "617-555-0188"],
      text: [
        "Turn this CRM note into next steps.",
        "Customer Chloe Brown at Nimbus Corporation asked for pricing.",
        "Reach her at chloe.brown@nimbus.example or 617-555-0188."
      ].join("\n")
    },
    {
      id: "legal-review",
      title: "Legal review",
      expect: ["PERSON", "ORG", "PASSPORT", "LOCATION"],
      sensitive: ["Omar Hassan", "Evergreen Foundation", "passport no. K87654321", "London"],
      text: [
        "Extract legal obligations from this memo.",
        "Signer Omar Hassan represents Evergreen Foundation.",
        "The memo references passport no. K87654321 and a London office."
      ].join("\n")
    },
    {
      id: "database-connection",
      title: "Database connection",
      expect: ["SECRET", "IP_ADDRESS", "URL"],
      sensitive: ["dbPassword987", "172.16.0.19", "https://admin.example.com/db"],
      text: [
        "Explain why this database login fails.",
        "host=172.16.0.19 password=dbPassword987",
        "Admin console: https://admin.example.com/db"
      ].join("\n")
    },
    {
      id: "bearer-token",
      title: "Bearer token request",
      expect: ["BEARER_TOKEN", "EMAIL"],
      sensitive: ["Bearer mF_9.B5f-4.1JqM0123456789abcdefghijklmnopqrstuvwxyz", "security@example.com"],
      text: [
        "Rewrite this API support ticket.",
        "Authorization: Bearer mF_9.B5f-4.1JqM0123456789abcdefghijklmnopqrstuvwxyz",
        "Escalate to security@example.com."
      ].join("\n")
    },
    {
      id: "university-research",
      title: "University research",
      expect: ["PERSON", "ORG", "EMAIL", "LOCATION"],
      sensitive: ["Prof. Alice Chen", "Pacific University", "alice.chen@pacific.example", "Tokyo"],
      text: [
        "Summarize the research collaboration.",
        "Prof. Alice Chen from Pacific University is coordinating from Tokyo.",
        "Her email is alice.chen@pacific.example."
      ].join("\n")
    },
    {
      id: "insurance-claim",
      title: "Insurance claim",
      expect: ["PERSON", "PHONE", "ADDRESS", "DRIVER_LICENSE"],
      sensitive: ["Ethan Miller", "303-555-0110", "88 Pine Road", "DL M76543210"],
      text: [
        "Create an insurance claim summary for Ethan Miller.",
        "Phone: 303-555-0110.",
        "Loss address: 88 Pine Road.",
        "Driver details include DL M76543210."
      ].join("\n")
    },
    {
      id: "vendor-contract",
      title: "Vendor contract",
      expect: ["ORG", "TAX_ID", "EMAIL", "URL"],
      sensitive: ["Blue River LLC", "Tax ID 98-7654321", "contracts@blueriver.example", "https://contracts.example.com/blue-river"],
      text: [
        "Review this vendor contract summary.",
        "Vendor: Blue River LLC, Tax ID 98-7654321.",
        "Contact contracts@blueriver.example and portal https://contracts.example.com/blue-river."
      ].join("\n")
    },
    {
      id: "multi-person-message",
      title: "Multi-person message",
      expect: ["PERSON", "EMAIL", "PHONE", "LOCATION"],
      sensitive: ["Maya Patel", "Derek Wilson", "maya.patel@example.com", "555-555-0101", "Austin"],
      text: [
        "Draft a neutral message for Maya Patel and Derek Wilson.",
        "Maya uses maya.patel@example.com and 555-555-0101.",
        "Both will meet in Austin next week."
      ].join("\n")
    },
    {
      id: "benign-technical",
      title: "Benign technical prompt",
      expect: [],
      sensitive: [],
      text: [
        "Explain how to debounce a text input in React.",
        "Use a short example and mention cleanup in useEffect."
      ].join("\n")
    }
  ];

  if (typeof module !== "undefined" && module.exports) {
    module.exports = scenarios;
  }

  root.PASTE_TEST_SCENARIOS = scenarios;
})(typeof globalThis !== "undefined" ? globalThis : window);
