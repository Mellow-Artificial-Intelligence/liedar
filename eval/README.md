> Liedar supports OpenAI Decisions (`gpt-6-luna`) and TypeSafe Jev (`jev-latest`) and now uses a native reliability rubric with separate provenance and quality signals. Results and TypeSafe cost estimates below describe the historical Jev implementation, not the current rubric for either provider. Use a fresh `--label` for every provider, model, or rubric change to avoid resuming incompatible results.

The evaluation runner selects a provider automatically from the environment: `OPENAI_API_KEY` takes precedence over `TYPESAFE_AI_API_KEY`. It has no `--provider` option; to evaluate TypeSafe, leave `OPENAI_API_KEY` unset or empty, including in `.env`. Use labels such as `openai-0.3.0` and `typesafe-0.3.0`. The current result files record predicate probabilities and the legacy fraud summary; they do not record or evaluate the native reliability score.

# Evaluation

Measures how well liedar tells forged documents from genuine ones on a public dataset.

```bash
bun run eval find-it-again                      # downloads the dataset, then checks every document
bun run eval find-it-again --view pixels-only   # the same documents, with their metadata removed
bun run eval find-it-again --view jpeg          # the same documents, saved as JPEG the way most photos arrive
bun run eval find-it-again --limit 50           # 50 forged and 50 genuine, the same ones every run
bun run eval:report eval/results/*.jsonl        # Markdown summary of each results file
```

Results go to `eval/results/<dataset>.<view>.jsonl`, one line per document. A run that stops partway picks up where it left off, and documents that failed are retried. Datasets download to `eval/data`. Both folders are ignored by git, and the data shouldn't be committed or redistributed.

## Dataset

`find-it-again` is [Find it again!](https://l3i-share.univ-lr.fr/2023Finditagain/index.html) from ICDAR 2023 ([paper](https://l3i.univ-larochelle.fr/app/uploads/sites/12/2024/05/ICDAR_2023_Find_it_again.pdf)). It has 987 usable scanned receipts from SROIE. 162 of them were forged by hand in Paint, GIMP, Preview, Paint 3D, and KolourPaint, using copy and paste, imitated text, deletions, and pixel edits. It's a free download with no license terms attached.

To add a dataset, add an entry to `DATASETS` in `datasets.ts` that downloads it and lists each document with its label.

## Views

Every document is copied under a neutral name with a fixed modification time before it's checked. A dataset that names or dates forgeries differently from genuine files could otherwise give the answer away through metadata. The current implementation omits the filesystem modification time from model evidence.

- **`as-is`** sends the file's own bytes, metadata included. This is how liedar is used.
- **`pixels-only`** re-encodes the image as an RGB PNG on white with no metadata, so only what the page looks like can give a forgery away.
- **`jpeg`** re-encodes it as a JPEG at quality 85 with no metadata, the way most photos and uploads arrive. Compression changes every pixel slightly, so a pasted patch no longer matches its source exactly.

Compare the two before trusting an `as-is` score. In Find-It-Again, saving through an editor left traces that track the label almost perfectly: 102 of 162 forgeries gained an alpha channel, against 1 of 825 genuine receipts, and 91 forgeries lost the `date:modify` text chunk that every genuine receipt has. Those are real forensic traces, but they come from how the dataset was made as much as from the forgery, and a fraudster exporting a JPEG or a PDF wouldn't leave them.

## Metrics

- **AUROC** of the fraud probability, with a bootstrapped 95% interval: the chance a random forgery scores above a random genuine document. 0.5 is chance. It doesn't depend on the threshold, which matters because model probabilities aren't calibrated.
- **Recall, false positive rate, precision, and F1** at liedar's threshold, and at the threshold that best separates the labels.
- **Each signal's AUROC**, showing which questions carry information.
- **Breakdowns by tag**, such as the forgery tool.
- **Calibration**: how often documents in each band of fraud probability were really fraud.

Historically, a full run of one view cost about $0.20 at TypeSafe's list price and took a few minutes, most of it pixel forensics. Measure current pricing and runtime for the selected provider and rubric before a full run.

## Results

Measured on `jev-latest` in October 2026. Changes to liedar are developed on the `train` split (577 receipts, 94 forged) only. The `val` and `test` splits (410 receipts, 68 forged) are held out and scored once per finished version: they've been scored for 0.1.1 and for each version below, and nothing was tuned on them. Develop with `--tag split=train`, and score the held-out splits only when a change is done.

Held-out results, at each version's own threshold:

| Version | View | AUROC (95% CI) | Recall | False positive rate |
| --- | --- | --- | ---: | ---: |
| 0.1.1 | `as-is` | 0.40 (0.31 to 0.49) | 32% | 42% |
| Signal fixes | `as-is` | 0.88 (0.81 to 0.94) | 82% | 20% |
| Pixel forensics | `as-is` | 0.98 (0.94 to 1.00) | 93% | 1% |
| Near copies | `as-is` | 0.97 (0.93 to 1.00) | 96% | 0% |
| 0.1.1 | `pixels-only` | 0.54 (0.46 to 0.62) | 15% | 4% |
| Signal fixes | `pixels-only` | 0.57 (0.48 to 0.65) | 25% | 14% |
| Pixel forensics | `pixels-only` | 0.88 (0.82 to 0.93) | 72% | 0% |
| Near copies | `pixels-only` | 0.87 (0.81 to 0.93) | 72% | 0% |
| Near copies | `jpeg` | 0.79 (0.71 to 0.86) | 46% | 2% |

On `train`, the historical near-copies version scored 0.90 in `pixels-only` and 0.77 in `jpeg`, so the held-out results aren't a product of tuning to the data. At its 0.75 threshold, it catches 65 of the 68 held-out forgeries with 1 false alarm among 342 genuine receipts, 49 of 68 with 1 false alarm from the pixels alone, and 31 of 68 with 8 false alarms once the receipts are JPEGs. The `jpeg` view wasn't run on held-out data before near copies; on `train`, the version before them scored 0.52 there, catching 2 of 94.

### Pixel forensics

Before Jev sees a page, `src/forensics.ts` looks for regions that exactly duplicate another region of the same page, then shows Jev each one as an outlined close-up of the source beside the copy. Most of the dataset's forgeries copy characters from elsewhere on the receipt, and a scan's noise means that never happens by chance. On its own it flags 73 of the 94 forged `train` receipts and 10 of the 483 genuine ones. Jev then judges what each copy covers, and its visual tampering answer rose from 0.50 to 0.87 AUROC with the close-ups in front of it.

What made the check precise, all found on `train`:

- **JPEG tiles.** SROIE's scans were JPEGs, which decode flat 8×8 tiles identically, so copies shifted by a multiple of 8 both ways aren't counted. A real paste lands on that grid 1 time in 64.
- **Strokes.** A uniform stroke or ruled line matches itself a few pixels away, so shifts under 16 pixels aren't counted.
- **Rendered text.** In a screenshot, 91% of textured blocks repeat; in the dataset's scans, at most 13%. Above 25%, the check reports that it can't run.
- **Gray pixels.** Each block must include gray pixels, which carry noise, not only black and white.

It misses forgeries that don't copy from the same page: text typed in a matching font, pixels painted by hand, and patches pasted from another image. It doesn't check PDFs yet.

### Near copies

A pasted patch saved as JPEG no longer matches its source exactly: on `train` saved as JPEG at quality 85, the exact check finds 4 of 94 forgeries. For JPEGs, `src/near-copies.ts` also looks for copies that match up to compression. Each 9×9 block gets a coarse signature, the rounded means of its nine 3×3 cells, which survives compression often enough for a patch's blocks to agree on the shift between source and copy. Each candidate shift is then checked pixel by pixel, keeping blocks whose squared difference from their copy is under 0.6% of their own variance, and a region needs 40 such blocks. On its own it flags 54 of the 94 forged `train` JPEGs and 33 of the 483 genuine ones, so the evidence is weaker than an exact copy, and Jev gets it as a separate signal that counts only when the copy covers a figure someone would change.

What kept false matches down, all found on `train`:

- **Edges and patterns.** A straight edge matches itself further along, and a dashed line or repeated heading matches again at twice the shift, so blocks that do either aren't counted. This halved false matches.
- **Black and white scans.** In a scan thresholded to black and white, every printing of a character is identical, so near matching is skipped when over 90% of pixels are pure black or white. That's 174 of the 577 `train` JPEGs.
- **Screenshots.** A JPEG screenshot no longer repeats exactly enough to trip the rendered-text check, but still repeats far more than a scan, so near matching runs only when under 15% of blocks repeat exactly. Real JPEG receipts stay under 12%; JPEG screenshots repeat over 20%.
- **Lossless images aren't near-matched.** A copy in a PNG stays exact, so there a near match is a character printed twice. PNG results are the same as before.

What didn't work: a looser tolerance, or one judged on raw differences rather than relative to the block's contrast, flagged most genuine receipts. Two printings of a character in a crisp font differ by about as much as JPEG noise, and heavier compression erases the difference further: at quality 75, near matching finds 41 of 94 forgeries and flags 36 genuine receipts. A noise-floor check didn't help either, since most receipts' paper scans as pure white.

### Signal fixes

- **The verdict is the strongest signal.** Jev's separate overall answer scored 0.56 on `train`, while the editing software signal alone scored 0.77. Every fraud verdict now has a reason.
- **The threshold is 0.75.** On `train`, answers between 0.5 and 0.75 came almost entirely from genuine receipts: raising it cut false alarms from 18% to 1% and recall from 85% to 84%.
- **Metadata dates no longer raise alarms.** The date questions say that a scan, copy, or conversion made after a document was issued is normal, and liedar no longer sends the file's modification time on disk. 0.1.1 flagged 42% of genuine receipts, mostly for dates their conversion left out of order.
- **Editing software includes an alpha channel**, which scanners and cameras don't produce.
- **The numbers check is three narrow ones:** line items, tax against its rate, and payment and change, each answering no when its figures are missing.
- **Implausible details asks for specific evidence.** It fired on 31% of genuine receipts and now fires on 4%.

Jev reads receipts well (98% accuracy on their printed dates, with or without full-resolution tiles), so the remaining misses aren't about legibility.

### Caveats

- One dataset of scanned receipts. Nothing here measures PDFs, camera photos, or other document types. The `jpeg` view re-saves scans as JPEG, which approximates an edited photo but isn't one.
- On JPEGs, liedar catches fewer than half of these forgeries. Copies saved at lower quality, black and white scans, and PDFs remain blind spots.
- In `as-is`, part of the score is the alpha channel that editing added to this dataset's forgeries, a trace a forger exporting JPEG or PDF wouldn't leave. `pixels-only` is the fairer measure of what liedar sees.
- The held-out splits have now been scored four times in the PNG views and once as JPEGs. Each score was of a finished version, but the next improvement deserves a fresh test set, such as your own known-good and known-bad documents.
