/**
 * Checks every document in a dataset with liedar, appending one JSON line per
 * document to eval/results/<dataset>.<view>.jsonl. Running it again skips
 * documents already checked and retries ones that failed.
 *
 *   bun run eval find-it-again --view pixels-only --limit 50
 *   bun run eval find-it-again --tag split=train --label shorter-questions
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { checkDocument, loadDocument, LiedarError } from "../src/index.ts";
import { DATA_DIRECTORY, datasetNamed, type Sample } from "./datasets.ts";

export const RESULTS_DIRECTORY = join(import.meta.dirname, "results");

export type ResultRow = {
  dataset: string;
  view: View;
  id: string;
  fraud: boolean;
  tags: Record<string, string>;
  fraudProbability?: number;
  /** Each signal's confidence, by key. */
  signals?: Record<string, number>;
  error?: { code: string; message: string };
};

/**
 * How each file reaches liedar. Either way it's copied under a neutral name
 * with a fixed modification time, since datasets name forgeries differently
 * from genuine files and liedar sends both to Jev.
 */
const VIEWS = {
  /** The file's own bytes, metadata included. */
  "as-is": async (bytes: Uint8Array, extension: string) => ({ bytes, extension }),
  /** Re-encoded as an RGB PNG with no metadata, so only what the page looks like can give a forgery away. */
  "pixels-only": async (bytes: Uint8Array) => ({
    bytes: new Uint8Array(await sharp(bytes).flatten({ background: "#ffffff" }).toColourspace("srgb").png().toBuffer()),
    extension: ".png",
  }),
  /**
   * Re-encoded as a JPEG with no metadata, the way most photos and uploads
   * arrive. Compression changes every pixel slightly, so a pasted patch no
   * longer matches its source exactly.
   */
  jpeg: async (bytes: Uint8Array) => ({
    bytes: new Uint8Array(await sharp(bytes).flatten({ background: "#ffffff" }).toColourspace("srgb").jpeg({ quality: JPEG_QUALITY }).toBuffer()),
    extension: ".jpg",
  }),
};
type View = keyof typeof VIEWS;

/** A typical quality for phone cameras and upload pipelines. */
export const JPEG_QUALITY = 85;

const STAGED_MODIFIED_TIME = new Date("2026-01-01T00:00:00Z");
const MAX_ATTEMPTS = 4;
const FIRST_RETRY_DELAY_MS = 10_000;
/** Errors that would fail every document, so the run stops instead of recording each one. */
const FATAL_ERROR_CODES = new Set(["MISSING_API_KEY", "INVALID_API_KEY"]);

const USAGE = `Usage: bun run eval <dataset> [--view as-is|pixels-only|jpeg] [--limit <per label>] [--tag <key>=<value>] [--label <name>] [--concurrency <n>]`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      view: { type: "string", default: "as-is" },
      limit: { type: "string" },
      concurrency: { type: "string", default: "4" },
      tag: { type: "string" },
      label: { type: "string" },
    },
  });
  const [datasetName] = positionals;
  const dataset = datasetNamed(datasetName);
  const view = values.view as View;
  if (!(view in VIEWS)) {
    throw new Error(USAGE);
  }

  const directory = join(DATA_DIRECTORY, datasetName!);
  await dataset.download(directory);
  const samples = limitPerLabel(
    withTag(await dataset.samples(directory), values.tag),
    values.limit ? Number(values.limit) : undefined,
  );

  await mkdir(RESULTS_DIRECTORY, { recursive: true });
  const resultsName = [datasetName, view, values.label].filter(Boolean).join(".");
  const resultsPath = join(RESULTS_DIRECTORY, `${resultsName}.jsonl`);
  const checked = await checkedIds(resultsPath);
  const remaining = samples.filter((sample) => !checked.has(sample.id));
  console.error(`${datasetName} (${view}): ${samples.length - remaining.length} of ${samples.length} already checked.`);

  const stagingDirectory = await mkdtemp(join(tmpdir(), "liedar-eval-"));
  let done = 0;
  let writes = Promise.resolve();
  try {
    await forEachInParallel(remaining, Number(values.concurrency), async (sample) => {
      const row = { dataset: datasetName!, view, ...(await checkSample(sample, view, stagingDirectory)) };
      writes = writes.then(() => appendFile(resultsPath, `${JSON.stringify(row)}\n`));
      await writes;
      done++;
      if (row.error || done % 25 === 0 || done === remaining.length) {
        console.error(`  ${done} of ${remaining.length}${row.error ? `  ${row.id}: ${row.error.code} ${row.error.message}` : ""}`);
      }
    });
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  console.error(`Results in ${resultsPath}. Summarize with: bun run eval:report ${resultsPath}`);
}

async function checkSample(sample: Sample, view: View, stagingDirectory: string): Promise<Omit<ResultRow, "dataset" | "view">> {
  const result = { id: sample.id, fraud: sample.fraud, tags: sample.tags };
  const sampleDirectory = join(stagingDirectory, hash(sample.id));
  try {
    const { bytes, extension } = await VIEWS[view](new Uint8Array(await readFile(sample.path)), extname(sample.path).toLowerCase());
    const stagedPath = join(sampleDirectory, `document${extension}`);
    await mkdir(sampleDirectory);
    await writeFile(stagedPath, bytes);
    await utimes(stagedPath, STAGED_MODIFIED_TIME, STAGED_MODIFIED_TIME);

    const report = await withRetries(async () => checkDocument(await loadDocument(stagedPath)));
    return {
      ...result,
      fraudProbability: report.fraudProbability,
      signals: Object.fromEntries(report.signals.map((signal) => [signal.key, signal.confidence])),
    };
  } catch (error) {
    if (error instanceof LiedarError && FATAL_ERROR_CODES.has(error.code)) {
      throw error;
    }
    const code = error instanceof LiedarError ? error.code : "UNEXPECTED";
    return { ...result, error: { code, message: error instanceof Error ? error.message : String(error) } };
  } finally {
    await rm(sampleDirectory, { recursive: true, force: true });
  }
}

async function withRetries<Result>(task: () => Promise<Result>): Promise<Result> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (!(error instanceof LiedarError && error.retryable) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1)));
    }
  }
}

/** Runs `task` on every item, at most `limit` at a time. */
async function forEachInParallel<Item>(items: Item[], limit: number, task: (item: Item) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      await task(items[next++]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** With a tag such as split=train, keeps only the samples that have it. */
function withTag(samples: Sample[], tag: string | undefined) {
  if (tag === undefined) {
    return samples;
  }
  const [key = "", value] = tag.split("=");
  if (value === undefined) {
    throw new Error(USAGE);
  }
  return samples.filter((sample) => sample.tags[key] === value);
}

/** With a limit, takes that many of each label, chosen by a hash of the ID so every run picks the same ones. */
function limitPerLabel(samples: Sample[], limit: number | undefined) {
  if (limit === undefined) {
    return samples;
  }
  const byHash = [...samples].sort((a, b) => hash(a.id).localeCompare(hash(b.id)));
  return [true, false].flatMap((fraud) => byHash.filter((sample) => sample.fraud === fraud).slice(0, limit));
}

/** IDs already in the results file without an error. */
async function checkedIds(resultsPath: string) {
  if (!existsSync(resultsPath)) {
    return new Set<string>();
  }
  const rows = (await readFile(resultsPath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ResultRow);
  return new Set(rows.filter((row) => !row.error).map((row) => row.id));
}

function hash(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
