# forged

Checks a document for signs of fraud from the terminal. It reads the file's metadata, renders each page to an image, and asks [Jev](https://vercel.com/i/what-is-jev) (TypeSafe AI, through Vercel AI Gateway) whether the document is likely fraudulent and how likely each of a fixed set of fraud signals is.

The result is a screening signal, not a determination. Jev's image input is experimental, and its probabilities are not calibrated for fraud. Check its answers against documents you know are genuine or fake before relying on them.

## Requirements

- [Bun](https://bun.sh) 1.3 or later
- A [Vercel AI Gateway API key](https://vercel.com/docs/ai-gateway/authentication-and-byok)

## Setup

```bash
bun install
cp .env.example .env   # add your AI Gateway API key
```

## Usage

```bash
bun run check invoice.pdf
bun run check receipt.jpg --json   # metadata, verdict, and every signal as JSON
```

```
LIKELY FRAUD  fraud probability 87%

Reasons
   95%  Made or edited with editing software
   60%  Modified after it was created
```

Supports PDF, PNG, and JPEG. PDFs send their first 10 pages.

## How it works

1. **Metadata.** `src/document.ts` collects the file's size and SHA-256 hash, plus the PDF's metadata (producer, creator, created and modified dates, saved versions, repairs) or the image's EXIF and XMP tags.
2. **Page images.** PDF pages are rendered with [pdf.js](https://mozilla.github.io/pdf.js/). `src/page-image.ts` then fits every page image within [Jev's image limits](https://docs.typesafe.ai/images#limits): it rotates photos upright from their EXIF orientation, shrinks the longest side to 1568 px, and pads any side under 280 px with white.
3. **Decision.** `src/fraud-check.ts` sends the metadata and page images to Jev in one request. It asks one yes/no question for the overall verdict and one for each fraud signal. Each signal's probability is its confidence, and signals at 50% or above are reported as reasons.

To change the signals, edit `FRAUD_SIGNALS` in `src/fraud-check.ts`. Each has a `label` for the terminal and the `instructions` Jev is asked.

## Development

```bash
bun test            # runs with a mock Jev, no API key needed
bun run typecheck
```

## License

[MIT](LICENSE)
