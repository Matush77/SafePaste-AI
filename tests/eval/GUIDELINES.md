# Evaluation corpus: labelling guidelines

The corpus in `tests/eval/corpus/` measures both sides of redaction quality:

- **Recall (leaks):** every labelled value must be fully redacted.
- **Precision (damage):** anything redacted outside a labelled value is a false positive. False positives break code and prose, and users who hit them turn the extension off.

The labels, not the current detectors, define what is sensitive. Never change a label to make a score go up.

## File format

Each `.txt` file holds several samples. A sample starts with a header line and runs until the next header:

```
=== secrets/env-file
DATABASE_URL=postgres://app:«credentials:Tr0ub4dor&3»@db.internal:5432/app
```

Label a sensitive value inline as `«category:value»`. The markers are stripped before the text is redacted. Categories are the setting keys in `src/redactor.js`: `apiKeys`, `credentials`, `emails`, `phones`, `financial`, `governmentIds`, `network`, `addresses`, `people`, `organizations`, `locations`, `urls`.

Files named `benign-*.txt` must not contain any labels. Every redaction in them counts as a false positive.

## What to label

| Category | Label | Do not label |
|---|---|---|
| apiKeys | The whole token, including its prefix (`sk-ant-...`, `ghp_...`). | Key names (`OPENAI_API_KEY`), obviously fake placeholders like `<your-key-here>` or `xxxx`. |
| credentials | Only the secret value: passwords, client secrets, the password part of a connection string, session cookies. | The key or field name. Variable references (`password = getPassword()`, `$DB_PASSWORD`, `process.env.TOKEN`). |
| emails | Every real-looking address of a person or organisation. | |
| phones | The full number including country code and extension. | Order numbers, timestamps, IDs and other digit runs that are not phone numbers. |
| financial | Card numbers, IBANs, account and routing numbers. | Prices, amounts, invoice numbers. |
| governmentIds | SSNs, passport, national ID, tax ID, driving licence numbers, and dates of birth given as such. | Other dates. |
| network | Public and private IP addresses and MAC addresses of real infrastructure. | `127.0.0.1`, `0.0.0.0`, `localhost`, CIDR examples in documentation, version numbers. |
| addresses | Street address lines, PO boxes, and city + postcode lines of a specific person or site. | A city mentioned on its own (see locations). |
| people | Names of private individuals, with or without a title. Label the name only, not "Dr." or "Mr.". | Public figures in a general-knowledge context ("Linus Torvalds wrote Git"), fictional characters, product names. |
| organizations | Private business relationships: a customer, vendor, employer or patient's insurer named in confidential text. | Well-known products and platforms mentioned as technology (React, AWS, Google Cloud, PostgreSQL), universities or companies in general discussion. |
| locations | A place that reveals where a specific person lives, works or travels. | Places in general discussion ("the history of Paris", "Berlin office" in a public job ad). |
| urls | Internal URLs that reveal private infrastructure, and URLs carrying a secret (label those `credentials` if the secret is a token in the query). | Public documentation and repository links. |

When in doubt, ask whether a careful person would be upset to see the value in an AI provider's logs. If yes, label it.

## Scoring

- A labelled value counts as **caught** only if every letter and digit in it is covered by a redaction. Redacting half a token is a leak.
- A redaction counts as a **false positive** if it covers no letter or digit of any labelled value.
- Scores are reported per category and overall. `tests/eval/baseline.json` records the last accepted scores, and the test suite fails if any score drops.
