/**
 * Loads a document from disk: collects its metadata and renders each page to
 * an image so Jev can look at it.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { JSONValue } from "ai";
import exifr from "exifr";
import * as mupdf from "mupdf";

/** Pages beyond this are skipped to keep requests a reasonable size. */
export const MAX_PAGES = 10;

/** Render PDFs at 2x (144 DPI) so small print and edits stay legible. */
const PDF_RENDER_SCALE = 2;

const MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export type PageImage = { mediaType: string; data: Uint8Array };

type JsonRecord = Record<string, JSONValue>;

export type LoadedDocument = {
  metadata: JsonRecord;
  pages: PageImage[];
  totalPages: number;
};

export async function loadDocument(path: string): Promise<LoadedDocument> {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (!mediaType) {
    throw new Error(`Unsupported file type. Use one of: ${Object.keys(MEDIA_TYPES).join(", ")}`);
  }

  const bytes = new Uint8Array(await readFile(path));
  const fileMetadata = await readFileMetadata(path, bytes, mediaType);

  if (mediaType === "application/pdf") {
    const { metadata, pages, totalPages } = loadPdf(bytes);
    return { metadata: { file: fileMetadata, pdf: metadata }, pages, totalPages };
  }

  return {
    metadata: { file: fileMetadata, image: await readImageMetadata(bytes) },
    pages: [{ mediaType, data: bytes }],
    totalPages: 1,
  };
}

async function readFileMetadata(path: string, bytes: Uint8Array, mediaType: string) {
  const stats = await stat(path);
  return {
    name: basename(path),
    mediaType,
    sizeBytes: stats.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    modifiedOnDisk: stats.mtime.toISOString(),
  };
}

function loadPdf(bytes: Uint8Array) {
  const document = mupdf.Document.openDocument(bytes, "application/pdf");
  const pdf = document.asPDF();
  const totalPages = document.countPages();

  const metadata = withoutEmptyValues({
    format: document.getMetaData(mupdf.Document.META_FORMAT),
    encryption: document.getMetaData(mupdf.Document.META_ENCRYPTION),
    title: document.getMetaData(mupdf.Document.META_INFO_TITLE),
    author: document.getMetaData(mupdf.Document.META_INFO_AUTHOR),
    subject: document.getMetaData(mupdf.Document.META_INFO_SUBJECT),
    keywords: document.getMetaData(mupdf.Document.META_INFO_KEYWORDS),
    creator: document.getMetaData(mupdf.Document.META_INFO_CREATOR),
    producer: document.getMetaData(mupdf.Document.META_INFO_PRODUCER),
    creationDate: document.getMetaData(mupdf.Document.META_INFO_CREATIONDATE),
    modificationDate: document.getMetaData(mupdf.Document.META_INFO_MODIFICATIONDATE),
    pageCount: totalPages,
    // Each incremental save appends a version; more than one means the file was edited after it was first written.
    savedVersions: pdf?.countVersions(),
    neededRepair: pdf?.wasRepaired(),
  });

  const pages: PageImage[] = [];
  for (let index = 0; index < Math.min(totalPages, MAX_PAGES); index++) {
    const pixmap = document
      .loadPage(index)
      .toPixmap(mupdf.Matrix.scale(PDF_RENDER_SCALE, PDF_RENDER_SCALE), mupdf.ColorSpace.DeviceRGB);
    pages.push({ mediaType: "image/png", data: pixmap.asPNG() });
  }

  return { metadata, pages, totalPages };
}

/** EXIF, TIFF, and XMP tags, such as the camera, editing software, and capture and edit dates. */
async function readImageMetadata(bytes: Uint8Array): Promise<JsonRecord> {
  const tags = await exifr.parse(bytes, { tiff: true, exif: true, xmp: true, gps: false }).catch(() => null);
  return tags ? toJson(tags) : {};
}

function withoutEmptyValues(record: Record<string, JSONValue | undefined>): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, JSONValue] => entry[1] !== undefined && entry[1] !== ""),
  );
}

/** Drops binary tag values (thumbnails, color profiles) and converts dates to strings. */
function toJson(tags: Record<string, unknown>): JsonRecord {
  return JSON.parse(
    JSON.stringify(tags, (_key, value) => (ArrayBuffer.isView(value) ? undefined : value)),
  );
}
