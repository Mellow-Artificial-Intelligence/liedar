# liedar

Lie radar for documents. It checks a document for signs of fraud, from the terminal or from code. It reads the file's metadata, looks for parts of each page copied from elsewhere on it, renders each page to an image, and asks [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions) how likely each of a fixed set of fraud signals is.

The result is a screening signal, not a determination. Model probabilities are not calibrated for fraud. Check its answers against documents you know are genuine or fake before relying on them. The historical Jev benchmark below has not been rerun with OpenAI.

## Usage

```bash
export OPENAI_API_KEY=...   # from https://platform.openai.com/api-keys
npx liedar invoice.pdf
npx liedar receipt.jpg --json   # verdict, every signal, the file's metadata, and pixel findings as JSON
```

```
REVIEW NEEDED  reliability 2.40 / 4

For review
   95%  Editing software appears in the metadata (provenance)
   80%  A later save is recorded (provenance)
```

Supports PDF, PNG, and JPEG. PDFs send their first 10 pages. Runs on Node 22.13 or later, or Bun 1.3 or later. The key can also go in a `.env` file in the working directory.

### JSON output

Output is JSON when you pass `--json` or when stdout isn't a terminal, so scripts and agents get it without asking:

```json
{
  "schemaVersion": 2,
  "note": "A screening signal, not a determination. ...",
  "report": {
    "likelyFraud": true,
    "reviewRequired": true,
    "reliability": { "score": 1.2, "maxScore": 4, "confidence": 0.85, "rubricVersion": 1 },
    "reviewReasons": ["...all signals above the review threshold, including contextual concerns"],
    "fraudProbability": 0.95,
    "reasons": [
      {
        "key": "visualTampering",
        "category": "tampering",
        "label": "A field shows localized editing artifacts",
        "question": "Do meaningful fields show localized evidence of replacement or erasure ...?",
        "confidence": 0.95
      }
    ],
    "signals": ["...every signal, in the same shape, most likely first"],
    "threshold": 0.75,
    "model": "gpt-6-luna",
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

`schemaVersion` changes only when a change could break a reader. Version 2 replaces the `JEV_*` error codes with `OPENAI_*` codes and uses `OPENAI_API_KEY`. Existing report fields are retained; reliability scoring and category-specific review fields are additive.

### Errors

Errors are JSON too, on stdout, whenever output is:

```json
{
  "schemaVersion": 2,
  "error": {
    "code": "MISSING_API_KEY",
    "message": "OPENAI_API_KEY is not set.",
    "fix": "Set OPENAI_API_KEY in the environment or in a .env file in the working directory. ...",
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
| `MISSING_API_KEY` | `OPENAI_API_KEY` isn't set |
| `INVALID_API_KEY` | OpenAI rejected the key |
| `OPENAI_RATE_LIMITED` | Still rate limited after one retry |
| `OPENAI_REQUEST_FAILED` | OpenAI couldn't be reached or returned an error |
| `OPENAI_BAD_RESPONSE` | OpenAI returned missing, refused, or invalid answers |
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

`checkDocument` reads the key from `OPENAI_API_KEY`, or takes it as `{ apiKey }`. Both functions throw a `LiedarError` with the `code`, `fix`, and `retryable` described above.

## Reliability scoring

Every signal probability and the overall reliability score comes directly from **one OpenAI Decisions request**. Local metadata and copied-region checks supply evidence; they do not independently assign scores. The overall answer is a native `score` question, not an average or maximum of the predicates.

| Category | Examples | Interpretation |
| --- | --- | --- |
| Tampering | Copied pixels over an amount; localized replacement or erasure | Possible material alteration |
| Consistency | Contradictory identifiers, impossible chronology, unreconciled readable amounts | Content needs verification |
| Provenance | Editor history, later saves, explicit AI-origin disclosures, possible synthesis artifacts | Context, not proof of fraud or AI generation |
| Quality | Unreadable critical fields, cropped or missing material content | Limits what can be verified |

`report.reliability.score` is a weighted score from 0 to 4: critical concerns, strong concerns, verification needed, limited concerns, and no observed concerns. `confidence` is the model's confidence in this rubric answer. Neither value is a probability that the document is genuine. `rubricVersion` identifies the scoring rubric.

`signals` contains every predicate probability with its `key`, `category`, `label`, and `question`. `reviewReasons` and `reviewRequired` apply the default 0.75 review threshold to all categories. Legacy `reasons`, `fraudProbability`, and `likelyFraud` consider only tampering and consistency; provenance or quality alone cannot set the fraud flag. Callers should use raw model scores to set and validate their own policies, for example:

```ts
const report = await checkDocument(await loadDocument("invoice.pdf"));
const needsReview = report.reliability.score < 2.5 || report.signals.some(
  (signal) => signal.category === "tampering" && signal.confidence >= 0.8,
);
```

These thresholds are illustrative, not validated. Generic layouts, unusual fonts, missing metadata, and an editor name do not establish fabrication. No external issuer lookup, digital-signature validation, watermark detection, or cryptographic C2PA verification is performed. A synthetic-origin declaration is only assessed if present in the evidence actually extracted; absent credentials do not establish AI origin. The model can miss alterations or misinterpret normal artifacts.

## Benchmark

These are historical Jev results, not measurements of the current OpenAI integration. The 75% threshold is retained pending a new evaluation.

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

Each document sends one OpenAI Decisions request using `gpt-6-luna`. See the [Decisions guide](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability) for pricing. Previous Jev token counts and cost estimates do not apply; measure representative documents before budgeting a large run.

## How it works

1. **Metadata.** `src/document.ts` collects the file's size and SHA-256 hash, plus the PDF's metadata (producer, creator, created and modified dates, saved versions, repairs) or the image's EXIF and XMP tags.
2. **Page images.** PDF pages are rendered with [pdf.js](https://mozilla.github.io/pdf.js/). `src/page-image.ts` then fits every page image to a consistent size: it rotates photos upright from their EXIF orientation, shrinks the longest side to 1568 px, and pads any side under 280 px with white.
3. **Pixel forensics.** For PNG and JPEG files, `src/forensics.ts` looks for regions of the page that copy another region. Sensor and paper noise mean a real scan or photo never repeats itself pixel for pixel, so an exact copy (`src/exact-copies.ts`) was pasted in, the commonest way receipts are altered. JPEG compression changes a pasted patch slightly, so for JPEGs `src/near-copies.ts` also finds copies that match up to compression. Those are weaker evidence, since the same character printed twice can match as closely, and OpenAI weighs them as a separate signal. The checks skip repeats that JPEG tiles, straight edges, and dashed lines produce, don't near-match black and white scans, and don't check images that look digitally generated, such as screenshots, whose text repeats naturally. Each copied region becomes a close-up: the source and the copy side by side, outlined, with the page around them. PDF pages are rendered, so they aren't checked yet.
4. **Decision.** `src/fraud-check.ts` sends the metadata, page images, pixel findings, and close-ups to OpenAI in one request, through a small `fetch` client for [OpenAI's Decisions API](https://developers.openai.com/api/docs/guides/decisions) in `src/decisions.ts`. It asks 15 predicate questions plus one native reliability score question. Each predicate returns a probability, and the native score returns an overall 0–4 reliability assessment. Signals at 75% or above appear in `reviewReasons`; only tampering and consistency signals contribute to the legacy fraud summary.

To change the signals, edit `FRAUD_SIGNALS` in `src/fraud-check.ts`. Each has a `label` for the terminal and the `instructions` OpenAI is asked.

## Development

```bash
bun install
cp .env.example .env    # add your OpenAI API key
bun run check invoice.pdf

bun test                # runs with a mock Decisions API, no API key needed
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
