#!/usr/bin/env node
/**
 * Terminal entry point: `liedar <file> [--json]`.
 */
import { basename } from "node:path";
import { parseArgs, styleText } from "node:util";
import { loadDocument } from "./document.ts";
import { errorMessage, LiedarError } from "./errors.ts";
import { checkDocument, type FraudReport } from "./fraud-check.ts";

const USAGE = `Usage: liedar <file.pdf|png|jpg> [--json]

Prints JSON when --json is given or stdout isn't a terminal, including on errors.
Exit codes: 0 checked (whatever the verdict), 1 failed, 2 usage error.`;

/** Bumped when the JSON output changes in a way that could break a reader. */
const SCHEMA_VERSION = 2;

const NOTE =
  "A screening signal, not a determination. Model probabilities are not calibrated for fraud.";

// Checked before parsing, so a usage error is reported as JSON too.
const jsonOutput = process.argv.includes("--json") || !process.stdout.isTTY;

async function main() {
  loadEnvFile();
  const { positionals, values } = parseCommandLine();
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [path] = positionals;
  if (!path) {
    throw new LiedarError("USAGE", "No file given.", { fix: USAGE });
  }

  const document = await loadDocument(path);
  console.error(styleText("dim", `Checking ${basename(path)} (${pageSummary(document.pages.length, document.totalPages)})...`));
  const report = await checkDocument(document);

  if (jsonOutput) {
    printJson({ schemaVersion: SCHEMA_VERSION, note: NOTE, report, metadata: document.metadata, analysis: document.analysis });
  } else {
    printReport(report);
  }
}

function parseCommandLine() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new LiedarError("USAGE", errorMessage(error), { fix: USAGE, cause: error });
  }
}

/** Reads .env from the working directory under Node. Bun loads it on its own and has no `loadEnvFile`. */
function loadEnvFile() {
  try {
    process.loadEnvFile?.();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function pageSummary(sentPages: number, totalPages: number) {
  const pages = `${totalPages} ${totalPages === 1 ? "page" : "pages"}`;
  return sentPages < totalPages ? `${pages}, first ${sentPages} sent` : pages;
}

function printReport(report: FraudReport) {
  const verdict = report.reviewRequired
    ? styleText(["bold", "yellow"], "REVIEW NEEDED")
    : styleText(["bold", "green"], "NO CONCERNS FLAGGED");
  console.log(`\n${verdict}  ${styleText("dim", `reliability ${report.reliability.score.toFixed(2)} / ${report.reliability.maxScore}`)}\n`);

  if (report.reviewReasons.length === 0) {
    console.log("No reliability signals above the review threshold. This does not authenticate the document.\n");
    return;
  }

  console.log(styleText("bold", "For review"));
  for (const reason of report.reviewReasons) {
    console.log(`  ${percent(reason.confidence).padStart(4)}  ${reason.label} (${reason.category})`);
  }
  console.log();
}

function percent(probability: number) {
  return `${Math.round(probability * 100)}%`;
}

function printJson(value: object) {
  console.log(JSON.stringify(value, null, 2));
}

function reportError(error: unknown) {
  const liedarError =
    error instanceof LiedarError ? error : new LiedarError("UNEXPECTED", errorMessage(error), { cause: error });
  if (jsonOutput) {
    printJson({ schemaVersion: SCHEMA_VERSION, error: liedarError });
  } else {
    console.error(styleText("red", liedarError.message));
    if (liedarError.fix) {
      console.error(styleText("dim", liedarError.fix));
    }
  }
  process.exitCode = liedarError.code === "USAGE" ? 2 : 1;
}

main().catch(reportError);
