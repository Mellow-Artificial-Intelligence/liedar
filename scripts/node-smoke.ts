/**
 * Checks that the built package runs under Node: the library loads and renders
 * a PDF, and the CLI gets as far as asking for an API key. Run after `npm run build`.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadDocument } from "../dist/index.js";
import { buildPdf } from "../src/test-pdf.ts";

const directory = await mkdtemp(join(tmpdir(), "forged-smoke-"));
try {
  const path = join(directory, "invoice.pdf");
  await writeFile(path, buildPdf(), "latin1");

  const document = await loadDocument(path);
  assert.equal(document.totalPages, 1);
  assert.equal(document.pages.length, 1);
  assert.equal((document.metadata.pdf as { producer: string }).producer, "Acme Billing 4.2");

  // Runs from the temporary directory, away from any .env, so no real request is sent.
  const { TYPESAFE_AI_API_KEY: _, ...env } = process.env;
  const cliPath = join(import.meta.dirname, "../dist/cli.js");
  const cli = promisify(execFile)(process.execPath, [cliPath, path], { env, cwd: directory });
  await assert.rejects(cli, (error: { stderr: string }) => error.stderr.includes("TYPESAFE_AI_API_KEY is not set"));

  console.log("Node smoke test passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
