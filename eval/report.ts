/**
 * Summarizes eval results as Markdown: how well the fraud probability and each
 * signal separate fraud from genuine documents, broken down by tag.
 *
 *   bun run eval:report eval/results/*.jsonl
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { REASON_THRESHOLD } from "../src/index.ts";
import {
  auroc,
  aurocConfidenceInterval,
  bestThreshold,
  calibration,
  confusionAt,
  type ScoredItem,
} from "./metrics.ts";
import type { ResultRow } from "./run.ts";

type CheckedRow = ResultRow & { fraudProbability: number; signals: Record<string, number> };

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    throw new Error("Usage: bun run eval:report <results.jsonl>...");
  }
  for (const path of paths) {
    console.log(summarize(basename(path, ".jsonl"), await readRows(path)));
  }
}

/** The latest row for each document, since a rerun appends a new row for one that failed. */
async function readRows(path: string) {
  const rows = new Map<string, ResultRow>();
  for (const line of (await readFile(path, "utf8")).split("\n").filter(Boolean)) {
    const row = JSON.parse(line) as ResultRow;
    rows.set(row.id, row);
  }
  return [...rows.values()];
}

function summarize(title: string, rows: ResultRow[]) {
  const checked = rows.filter((row): row is CheckedRow => row.fraudProbability !== undefined && row.signals !== undefined);
  const errors = rows.length - checked.length;
  const fraudCount = checked.filter((row) => row.fraud).length;
  const verdicts = scored(checked, (row) => row.fraudProbability);
  const lines = [
    `## ${title}`,
    "",
    `${checked.length} documents checked (${fraudCount} fraud, ${checked.length - fraudCount} genuine)${errors ? `, ${errors} failed` : ""}.`,
    "",
    ...verdictTable(verdicts),
    "",
    "### Signals",
    "",
    "How well each answer separates fraud from genuine documents on its own.",
    "",
    ...signalTable(checked),
    "",
    ...Object.keys(checked[0]?.tags ?? {}).flatMap((tag) => tagTable(checked, tag)),
    "### Calibration",
    "",
    "Whether a fraud probability of p means fraud about p of the time.",
    "",
    ...calibrationTable(verdicts),
    "",
  ];
  return lines.join("\n");
}

function verdictTable(items: ScoredItem[]) {
  const [low, high] = aurocConfidenceInterval(items);
  const atDefault = confusionAt(items, REASON_THRESHOLD);
  const threshold = bestThreshold(items);
  const atBest = confusionAt(items, threshold);
  return [
    "| Metric | Value |",
    "| --- | --- |",
    `| AUROC | ${fixed(auroc(items))} (95% CI ${fixed(low)} to ${fixed(high)}) |`,
    `| At liedar's threshold (${fixed(REASON_THRESHOLD)}) | ${rates(atDefault)} |`,
    `| At the best threshold (${fixed(threshold)}) | ${rates(atBest)} |`,
    `| Confusion at ${fixed(REASON_THRESHOLD)} | ${atDefault.truePositives} caught, ${atDefault.falseNegatives} missed, ${atDefault.falsePositives} false alarms, ${atDefault.trueNegatives} cleared |`,
  ];
}

function signalTable(rows: CheckedRow[]) {
  const answer = (name: string, score: (row: CheckedRow) => number) => {
    const items = scored(rows, score);
    return { name, auroc: auroc(items), meanOnFraud: meanScore(items, true), meanOnGenuine: meanScore(items, false) };
  };
  const signals = Object.keys(rows[0]?.signals ?? {})
    .map((key) => answer(key, (row) => row.signals[key]!))
    .sort((a, b) => b.auroc - a.auroc);
  return [
    "| Answer | AUROC | Mean on fraud | Mean on genuine |",
    "| --- | ---: | ---: | ---: |",
    ...[answer("Fraud probability", (row) => row.fraudProbability), ...signals].map((row) =>
      tableRow([row.name, fixed(row.auroc), fixed(row.meanOnFraud), fixed(row.meanOnGenuine)]),
    ),
  ];
}

/**
 * Results for each value of one tag. AUROC compares the value's fraud with its
 * own genuine documents, or with every genuine document when it has none, as
 * when the tag is the forgery tool.
 */
function tagTable(rows: CheckedRow[], tag: string) {
  const values = [...new Set(rows.map((row) => row.tags[tag]!))].sort();
  if (values.length < 2) {
    return [];
  }
  const allGenuine = rows.filter((row) => !row.fraud);
  return [
    `### By ${tag}`,
    "",
    "| Value | Fraud | Genuine | AUROC | Caught at threshold | False alarms at threshold |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...values.map((value) => {
      const group = rows.filter((row) => row.tags[tag] === value);
      const fraud = group.filter((row) => row.fraud);
      const genuine = group.filter((row) => !row.fraud);
      const compared = scored([...fraud, ...(genuine.length > 0 ? genuine : allGenuine)], (row) => row.fraudProbability);
      const flagged = (subset: CheckedRow[]) => subset.filter((row) => row.fraudProbability >= REASON_THRESHOLD).length;
      return tableRow([
        value,
        fraud.length,
        genuine.length,
        fraud.length > 0 ? fixed(auroc(compared)) : "",
        fraud.length > 0 ? percent(flagged(fraud) / fraud.length) : "",
        genuine.length > 0 ? percent(flagged(genuine) / genuine.length) : "",
      ]);
    }),
    "",
  ];
}

function calibrationTable(items: ScoredItem[]) {
  return [
    "| Fraud probability | Documents | Mean probability | Actually fraud |",
    "| --- | ---: | ---: | ---: |",
    ...calibration(items)
      .filter((bin) => bin.count > 0)
      .map((bin) => `| ${fixed(bin.from, 1)} to ${fixed(bin.to, 1)} | ${bin.count} | ${fixed(bin.meanScore)} | ${percent(bin.fraudRate)} |`),
  ];
}

function tableRow(cells: (string | number)[]) {
  return `| ${cells.join(" | ")} |`;
}

function scored(rows: CheckedRow[], score: (row: CheckedRow) => number): ScoredItem[] {
  return rows.map((row) => ({ fraud: row.fraud, score: score(row) }));
}

function meanScore(items: ScoredItem[], fraud: boolean) {
  const matching = items.filter((item) => item.fraud === fraud);
  return matching.reduce((sum, item) => sum + item.score, 0) / matching.length;
}

function rates({ precision, recall, falsePositiveRate, f1, accuracy }: ReturnType<typeof confusionAt>) {
  return `recall ${percent(recall)}, false positive rate ${percent(falsePositiveRate)}, precision ${percent(precision)}, F1 ${fixed(f1)}, accuracy ${percent(accuracy)}`;
}

function fixed(value: number, digits = 2) {
  return Number.isNaN(value) ? "n/a" : value.toFixed(digits);
}

function percent(value: number) {
  return Number.isNaN(value) ? "n/a" : `${Math.round(value * 100)}%`;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
