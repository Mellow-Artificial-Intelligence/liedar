# forged

Checks a document for signs of fraud. It reads the file's metadata, renders each page to an image, and asks [Jev](https://vercel.com/i/what-is-jev) (TypeSafe AI, through Vercel AI Gateway) whether the document is likely fraudulent and how likely each common fraud signal is.

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

- `src/document.ts` collects file metadata (size, hash), PDF metadata (producer, creator, dates, saved versions, repairs) or image EXIF/XMP tags, and renders PDF pages to PNG with MuPDF.
- `src/fraud-check.ts` sends the metadata and page images to Jev as one state with a boolean question for the overall verdict and one per fraud signal. Each signal's probability is its confidence; signals at 50% or above are reported as reasons.
- `src/cli.ts` is the terminal entry point.

Jev's image input through AI Gateway is experimental.
