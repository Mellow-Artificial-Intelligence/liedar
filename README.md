# liedar

Lie radar for documents. It checks a document for signs of fraud, from the terminal or from code. It reads the file's metadata, renders each page to an image, and asks [Jev](https://vercel.com/i/what-is-jev) (TypeSafe AI) whether the document is likely fraudulent and how likely each of a fixed set of fraud signals is.

The result is a screening signal, not a determination. Jev's image input is experimental, and its probabilities are not calibrated for fraud. Check its answers against documents you know are genuine or fake before relying on them.

## Usage

```bash
export TYPESAFE_AI_API_KEY=...   # from https://docs.typesafe.ai/api
npx liedar invoice.pdf
npx liedar receipt.jpg --json   # verdict, every signal, and the file's metadata as JSON
```

```
LIKELY FRAUD  fraud probability 87%

Reasons
   95%  Made or edited with editing software
   60%  Modified after it was created
```

Supports PDF, PNG, and JPEG. PDFs send their first 10 pages. Runs on Node 22.13 or later, or Bun 1.3 or later. The key can also go in a `.env` file in the working directory.

### JSON output

Output is JSON when you pass `--json` or when stdout isn't a terminal, so scripts and agents get it without asking:

```json
{
  "schemaVersion": 1,
  "note": "A screening signal, not a determination. ...",
  "report": {
    "likelyFraud": true,
    "fraudProbability": 0.87,
    "reasons": [
      {
        "key": "editingSoftware",
        "label": "Made or edited with editing software",
        "question": "Does the metadata show the file was created or modified with image or PDF editing software ...?",
        "confidence": 0.95
      }
    ],
    "signals": ["...every signal, in the same shape, most likely first"],
    "threshold": 0.5,
    "model": "jev-latest",
    "pagesChecked": 10,
    "totalPages": 14
  },
  "metadata": { "file": { "...": "..." }, "pdf": { "...": "..." } }
}
```

`schemaVersion` changes only when a change could break a reader.

### Errors

Errors are JSON too, on stdout, whenever output is:

```json
{
  "schemaVersion": 1,
  "error": {
    "code": "MISSING_API_KEY",
    "message": "TYPESAFE_AI_API_KEY is not set.",
    "fix": "Set TYPESAFE_AI_API_KEY in the environment or in a .env file in the working directory. ...",
    "retryable": false
  }
}
```

| Code | Meaning |
| --- | --- |
| `USAGE` | Missing file or unknown option |
| `FILE_NOT_FOUND` | No file at the path |
| `UNSUPPORTED_FILE_TYPE` | Not a PDF, PNG, or JPEG |
| `INVALID_DOCUMENT` | The file is damaged, password-protected, or not the type its extension says |
| `MISSING_API_KEY` | `TYPESAFE_AI_API_KEY` isn't set |
| `INVALID_API_KEY` | TypeSafe rejected the key |
| `JEV_RATE_LIMITED` | Still rate limited after one retry |
| `JEV_REQUEST_FAILED` | Jev couldn't be reached or returned an error |
| `JEV_BAD_RESPONSE` | Jev's response was missing an answer |
| `UNEXPECTED` | Anything else |

`retryable` says whether the same command may succeed later. The exit code is 0 when the check ran, whatever the verdict, 1 when it failed, and 2 for a usage error.

### As a library

```bash
npm install liedar
```

```ts
import { checkDocument, loadDocument } from "liedar";

const report = await checkDocument(await loadDocument("invoice.pdf"));
if (report.likelyFraud) {
  console.log(report.reasons.map((reason) => reason.label));
}
```

`checkDocument` reads the key from `TYPESAFE_AI_API_KEY`, or takes it as `{ apiKey }`. Both functions throw a `LiedarError` with the `code`, `fix`, and `retryable` described above.

## Cost

Each document is one Jev request, and TypeSafe [charges only for input tokens](https://docs.typesafe.ai/models), at $0.042 per million. Output is free. Measured on `jev-latest`, a check costs about 800 tokens for the metadata and questions, plus about one token per 384 pixels of page image:

| Document | Input tokens | Cost per document |
| --- | ---: | ---: |
| Small receipt photo (600 × 1400) | 3,000 | $0.00013 |
| 1-page PDF, or a phone photo | 5,800 | $0.00024 |
| Each extra PDF page | 5,000 | $0.00021 |
| 10-page PDF, the most sent | 50,500 | $0.0021 |

A Letter or A4 page renders at 1568 px on its long side, so every PDF page costs about the same whatever is on it, and a PDF longer than 10 pages costs the same as a 10-page one. Costs scale linearly with volume:

| Documents | Receipt photos | 1-page PDFs | 2-page PDFs | 5-page PDFs | 10-page PDFs |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | $0.13 | $0.24 | $0.45 | $1.08 | $2.12 |
| 10,000 | $1.26 | $2.43 | $4.52 | $10.76 | $21.19 |
| 50,000 | $6.30 | $12.14 | $22.58 | $53.82 | $105.95 |
| 100,000 | $12.60 | $24.29 | $45.17 | $107.65 | $211.91 |
| 250,000 | $31.50 | $60.72 | $112.92 | $269.12 | $529.77 |
| 500,000 | $63.00 | $121.44 | $225.83 | $538.23 | $1,059.53 |

These are list prices, measured on synthetic documents in October 2026. Measure a sample of your own documents before budgeting a large run.

## How it works

1. **Metadata.** `src/document.ts` collects the file's size and SHA-256 hash, plus the PDF's metadata (producer, creator, created and modified dates, saved versions, repairs) or the image's EXIF and XMP tags.
2. **Page images.** PDF pages are rendered with [pdf.js](https://mozilla.github.io/pdf.js/). `src/page-image.ts` then fits every page image within [Jev's image limits](https://docs.typesafe.ai/images#limits): it rotates photos upright from their EXIF orientation, shrinks the longest side to 1568 px, and pads any side under 280 px with white.
3. **Decision.** `src/fraud-check.ts` sends the metadata and page images to Jev in one request, through a small `fetch` client for [TypeSafe's API](https://docs.typesafe.ai/api) in `src/jev.ts`. It asks one yes/no question for the overall verdict and one for each fraud signal. Each signal's probability is its confidence, and signals at 50% or above are reported as reasons.

To change the signals, edit `FRAUD_SIGNALS` in `src/fraud-check.ts`. Each has a `label` for the terminal and the `instructions` Jev is asked.

## Development

```bash
bun install
cp .env.example .env    # add your TypeSafe AI API key
bun run check invoice.pdf

bun test                # runs with a mock Jev, no API key needed
bun run typecheck
bun run build && npm run smoke:node   # builds dist/ and checks it runs on Node
```

## Releasing

Releases publish to npm from GitHub Actions through [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored. Bump `version` in `package.json` in a PR, merge it, then create a release with a matching tag:

```bash
gh release create v0.2.0 --generate-notes
```

The publish workflow runs CI, checks the tag against `package.json`, and publishes with provenance.

## License

[MIT](LICENSE)
