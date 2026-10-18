#!/usr/bin/env node
/**
 * Terminal entry point: `forged <file> [--json]`.
 */
import { basename } from "node:path";
import { parseArgs, styleText } from "node:util";
import { loadDocument } from "./document.ts";
import { checkDocument, type FraudReport } from "./fraud-check.ts";

const USAGE = "Usage: forged <file.pdf|png|jpg> [--json]";

async function main() {
  loadEnvFile();
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [path] = positionals;
  if (!path) {
    console.error(USAGE);
    process.exit(1);
  }

  const document = await loadDocument(path);
  console.error(styleText("dim", `Checking ${basename(path)} (${pageSummary(document.pages.length, document.totalPages)})...`));
  const report = await checkDocument(document);

  if (values.json) {
    console.log(JSON.stringify({ metadata: document.metadata, report }, null, 2));
  } else {
    printReport(report);
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
  const verdict = report.likelyFraud
    ? styleText(["bold", "red"], "LIKELY FRAUD")
    : styleText(["bold", "green"], "LIKELY AUTHENTIC");
  console.log(`\n${verdict}  ${styleText("dim", `fraud probability ${percent(report.fraudProbability)}`)}\n`);

  if (report.reasons.length === 0) {
    console.log("No fraud signals above the threshold.\n");
    return;
  }

  console.log(styleText("bold", "Reasons"));
  for (const reason of report.reasons) {
    console.log(`  ${percent(reason.confidence).padStart(4)}  ${reason.label}`);
  }
  console.log();
}

function percent(probability: number) {
  return `${Math.round(probability * 100)}%`;
}

main().catch((error: unknown) => {
  console.error(styleText("red", error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
