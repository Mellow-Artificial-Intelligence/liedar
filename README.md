# liedar

Lie radar for documents. It checks a document for signs of fraud, from the terminal or from code. It reads the file's metadata, looks for parts of each page copied from elsewhere on it, renders each page to an image, and asks [Jev](https://vercel.com/i/what-is-jev) (TypeSafe AI) how likely each of a fixed set of fraud signals is.

On a public benchmark of receipts forged by hand, it catches 96% of forgeries with one false alarm in 342 genuine receipts ([Benchmark](#benchmark)). The result is still a screening signal, not a determination: Jev's image input is experimental, and its probabilities are not calibrated for fraud. Check its answers against documents you know are genuine or fake before relying on them.

## Usage

```bash
export TYPESAFE_AI_API_KEY=...   # from https://docs.typesafe.ai/api
npx liedar invoice.pdf
npx liedar receipt.jpg --json   # verdict, every signal, the file's metadata, and pixel findings as JSON
```

```
LIKELY FRAUD  fraud probability 95%

Reasons
   95%  Made or edited with editing software
   80%  Modified after it was created
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
    "fraudProbability": 0.95,
    "reasons": [
      {
        "key": "editingSoftware",
        "label": "Made or edited with editing software",
        "question": "Does the metadata show the file was created or modified with image or PDF editing software ...?",
        "confidence": 0.95
      }
    ],
    "signals": ["...every signal, in the same shape, most likely first"],
    "threshold": 0.75,
    "model": "jev-latest",
    "pagesChecked": 10,
    "totalPages": 14
  },
  "metadata": { "file": { "...": "..." }, "pdf": { "...": "..." } },
  "analysis": {
    "copiedRegions": {
      "checked": true,
      "copiedRegions": [
        {
          "match": "exact",
          "source": { "left": 0.775, "top": 0.473, "width": 0.038, "height": 0.019 },
          "copy": { "left": 0.748, "top": 0.605, "width": 0.038, "height": 0.019 },
          "matchingBlocks": 398
        }
      ]
    }
  }
}
```

Boxes in `analysis` are fractions of the page's width and height, measured from its top left corner. `match` is `"exact"` for a pixel-for-pixel copy or `"near"` for one that matches up to JPEG compression. When part of the check is skipped, a `note` says why, and when none of it can run, `copiedRegions` is `{ "checked": false, "reason": "..." }` instead.

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

## Benchmark

Measured on [Find it again!](https://l3i-share.univ-lr.fr/2023Finditagain/index.html) (ICDAR 2023): 987 scanned receipts, 162 of them forged by hand by copying characters, imitating text, deleting, and editing pixels. liedar was tuned on the dataset's training split only. These results are on the 410 receipts it never saw (68 forged, 342 genuine), at its 75% threshold, with `jev-latest` in October 2026.

| Input | Forgeries caught | Genuine receipts flagged | Precision | AUROC (95% CI) |
| --- | ---: | ---: | ---: | :---: |
| File as submitted | 65 / 68 (96%) | 1 / 342 (0.3%) | 98% | 0.97 (0.93–1.00) |
| Image only, metadata removed | 49 / 68 (72%) | 1 / 342 (0.3%) | 98% | 0.87 (0.81–0.93) |
| Image re-saved as JPEG | 31 / 68 (46%) | 8 / 342 (2.3%) | 79% | 0.79 (0.71–0.86) |

AUROC is the chance a random forgery scores above a random genuine receipt, so 0.5 is a coin flip and 1.0 is perfect. On the same receipts, 0.1.1 scored 0.40 as submitted and 0.54 from the image only, and flagged 42% of genuine receipts.

Two changes made the difference. Liedar stopped raising alarms over file dates that copying or conversion leaves out of order, and it now runs pixel forensics: it finds characters copied from one part of a page to another, the commonest way these receipts were altered, and shows Jev a close-up of each copy. Pixel forensics account for most of the image-only gain. Some caveats:

- **Image only is the fairest row.** As submitted, part of the score comes from a transparency channel that editing added to this dataset's forgeries, which a forger exporting JPEG or PDF wouldn't leave.
- **It's one dataset of scanned receipts.** PDFs and camera photos aren't measured, and PDF pages aren't checked for copied regions yet.
- **Real traffic has fewer forgeries.** The test set is 17% forged. At a 1% fraud rate, about 1 flag in 4 would be a genuine document.

To reproduce it, or to measure a change:

```bash
bun run eval find-it-again --view pixels-only --tag split=train   # develop on the training split
bun run eval:report eval/results/*.jsonl
```

[eval/README.md](eval/README.md) has the method, every view, results by version and signal, and what didn't work.

## Cost

Each document is one Jev request, and TypeSafe [charges only for input tokens](https://docs.typesafe.ai/models), at $0.042 per million. Output is free. Measured on `jev-latest`, a check costs about 800 tokens for the metadata and questions, plus about one token per 384 pixels of page image:

| Document | Input tokens | Cost per document |
| --- | ---: | ---: |
| Small receipt photo (600 × 1400) | 3,000 | $0.00013 |
| 1-page PDF, or a phone photo | 5,800 | $0.00024 |
| Each extra PDF page | 5,000 | $0.00021 |
| 10-page PDF, the most sent | 50,500 | $0.0021 |

A Letter or A4 page renders at 1568 px on its long side, so every PDF page costs about the same whatever is on it, and a PDF longer than 10 pages costs the same as a 10-page one. When an image has copied regions, each close-up (up to three) adds about 500 tokens. Costs scale linearly with volume:

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
3. **Pixel forensics.** For PNG and JPEG files, `src/forensics.ts` looks for regions of the page that copy another region. Sensor and paper noise mean a real scan or photo never repeats itself pixel for pixel, so an exact copy (`src/exact-copies.ts`) was pasted in, the commonest way receipts are altered. JPEG compression changes a pasted patch slightly, so for JPEGs `src/near-copies.ts` also finds copies that match up to compression. Those are weaker evidence, since the same character printed twice can match as closely, and Jev weighs them as a separate signal. The checks skip repeats that JPEG tiles, straight edges, and dashed lines produce, don't near-match black and white scans, and don't check images that look digitally generated, such as screenshots, whose text repeats naturally. Each copied region becomes a close-up: the source and the copy side by side, outlined, with the page around them. PDF pages are rendered, so they aren't checked yet.
4. **Decision.** `src/fraud-check.ts` sends the metadata, page images, pixel findings, and close-ups to Jev in one request, through a small `fetch` client for [TypeSafe's API](https://docs.typesafe.ai/api) in `src/jev.ts`. It asks one yes/no question for each fraud signal. Each signal's probability is its confidence, and signals at 75% or above are reported as reasons. The fraud probability is the strongest signal's confidence, so a document is likely fraud exactly when it has at least one reason.

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
