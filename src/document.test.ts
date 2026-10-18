import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadDocument } from "./document.ts";
import { MAX_SIDE_PIXELS } from "./page-image.ts";
import { buildPdf } from "./test-pdf.ts";

const directory = await mkdtemp(join(tmpdir(), "liedar-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

async function loadPdf(name: string, contents: string) {
  const path = join(directory, name);
  await writeFile(path, contents, "latin1");
  return loadDocument(path);
}

describe("loadDocument", () => {
  test("reads an untouched PDF's metadata and renders its page within Jev's limits", async () => {
    const document = await loadPdf("original.pdf", buildPdf());

    expect(document.metadata.pdf).toMatchObject({ producer: "Acme Billing 4.2", pageCount: 1, savedVersions: 1 });
    expect(document.totalPages).toBe(1);
    const { width, height } = await sharp(document.pages[0]?.data).metadata();
    expect([width, height]).toEqual([1212, MAX_SIDE_PIXELS]);
  });

  test("reports the later metadata and an extra saved version for an edited PDF", async () => {
    const document = await loadPdf("edited.pdf", buildPdf({ editedBy: "Adobe Photoshop 26.1" }));

    expect(document.metadata.pdf).toMatchObject({
      producer: "Adobe Photoshop 26.1",
      modificationDate: "D:20260915184400Z",
      savedVersions: 2,
    });
  });

  test("rejects unsupported file types", async () => {
    await expect(loadDocument(join(directory, "notes.txt"))).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
  });

  test("reports a missing file", async () => {
    await expect(loadDocument(join(directory, "missing.pdf"))).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  test("reports a file that isn't the type its extension says", async () => {
    await expect(loadPdf("not-really.pdf", "just some text")).rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
  });
});
