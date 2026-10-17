import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadDocument } from "./document";
import { MAX_SIDE_PIXELS } from "./page-image";

const directory = await mkdtemp(join(tmpdir(), "forged-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

/**
 * A one-page US Letter PDF using a standard font it doesn't embed. With
 * `editedBy`, an incremental save then rewrites its metadata, the way an
 * editing tool would.
 */
function buildPdf({ editedBy }: { editedBy?: string } = {}) {
  const text = "BT /F1 28 Tf 72 700 Td (INVOICE 2231 Total 4950.00) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Producer (Acme Billing 4.2) /CreationDate (D:20260301090000Z) >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  if (editedBy) {
    const infoOffset = pdf.length;
    pdf += `6 0 obj\n<< /Producer (${editedBy}) /CreationDate (D:20260301090000Z) /ModDate (D:20260915184400Z) >>\nendobj\n`;
    const updateXref = pdf.length;
    pdf += `xref\n6 1\n${String(infoOffset).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R /Prev ${xref} >>\nstartxref\n${updateXref}\n%%EOF\n`;
  }

  return pdf;
}

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
    await expect(loadDocument(join(directory, "notes.txt"))).rejects.toThrow("Unsupported file type");
  });
});
