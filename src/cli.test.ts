import { afterAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPdf } from "./test-pdf.ts";

const directory = await mkdtemp(join(tmpdir(), "liedar-cli-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

const CLI_PATH = join(import.meta.dirname, "cli.ts");

/** Runs the CLI with stdout piped, from an empty directory with no API key, so it never reaches OpenAI. */
function runCli(...args: string[]) {
  const { OPENAI_API_KEY: _, TYPESAFE_AI_API_KEY: _typesafe, ...env } = process.env;
  return new Promise<{ exitCode: number; stdout: string }>((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], { cwd: directory, env }, (error, stdout) => {
      resolve({ exitCode: typeof error?.code === "number" ? error.code : 0, stdout });
    });
  });
}

describe("cli", () => {
  test("prints errors as JSON when stdout isn't a terminal", async () => {
    await writeFile(join(directory, "invoice.pdf"), buildPdf(), "latin1");
    const { exitCode, stdout } = await runCli("invoice.pdf");

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout)).toEqual({
      schemaVersion: 2,
      error: {
        code: "MISSING_API_KEY",
        message: "OPENAI_API_KEY is not set.",
        fix: expect.stringContaining("https://platform.openai.com/api-keys"),
        retryable: false,
      },
    });
  });

  test("exits with 2 for a usage error", async () => {
    for (const args of [[], ["invoice.pdf", "--verbose"]]) {
      const { exitCode, stdout } = await runCli(...args);
      expect(exitCode).toBe(2);
      expect(JSON.parse(stdout).error.code).toBe("USAGE");
    }
  });

  test("prints help", async () => {
    const { exitCode, stdout } = await runCli("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: liedar");
  });
  test("accepts a provider override and rejects unknown providers", async () => {
    await writeFile(join(directory, "provider.pdf"), buildPdf(), "latin1");
    const selected = await runCli("provider.pdf", "--provider", "typesafe");
    expect(selected.exitCode).toBe(1);
    expect(JSON.parse(selected.stdout).error).toMatchObject({ code: "MISSING_API_KEY", message: "TYPESAFE_AI_API_KEY is not set." });
    const invalid = await runCli("provider.pdf", "--provider", "unknown");
    expect(invalid.exitCode).toBe(2);
    expect(JSON.parse(invalid.stdout).error.code).toBe("USAGE");
  });

});
