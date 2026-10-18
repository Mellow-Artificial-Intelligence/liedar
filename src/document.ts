/**
 * Loads a document from disk: collects its metadata and renders each page to
 * an image so Jev can look at it.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import exifr from "exifr";
import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { errorMessage, LiedarError } from "./errors.ts";
import { MAX_SIDE_PIXELS, toPageImage, type PageImage } from "./page-image.ts";

/** Pages beyond this are skipped to keep requests a reasonable size. */
export const MAX_PAGES = 10;

const MEDIA_TYPES: Record<string, "application/pdf" | "image/png" | "image/jpeg"> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** pdf.js needs its bundled fonts to draw PDFs that use standard fonts without embedding them. */
const PDFJS_DIRECTORY = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));

type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
type JsonRecord = Record<string, JSONValue>;
type RenderParameters = Parameters<PDFPageProxy["render"]>[0];

export type LoadedDocument = {
  metadata: JsonRecord;
  pages: PageImage[];
  totalPages: number;
};

export async function loadDocument(path: string): Promise<LoadedDocument> {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (!mediaType) {
    throw new LiedarError("UNSUPPORTED_FILE_TYPE", `Unsupported file type: ${basename(path)}`, {
      fix: `Use one of: ${Object.keys(MEDIA_TYPES).join(", ")}`,
    });
  }

  const bytes = await readBytes(path);
  const fileMetadata = await readFileMetadata(path, bytes, mediaType);

  try {
    if (mediaType === "application/pdf") {
      const { metadata, pages, totalPages } = await loadPdf(bytes);
      return { metadata: { file: fileMetadata, pdf: metadata }, pages, totalPages };
    }

    return {
      metadata: { file: fileMetadata, image: await readImageMetadata(bytes) },
      pages: [await toPageImage(bytes, mediaType === "image/png" ? "png" : "jpeg")],
      totalPages: 1,
    };
  } catch (error) {
    throw new LiedarError("INVALID_DOCUMENT", `Couldn't read ${basename(path)} as ${mediaType}: ${errorMessage(error)}`, {
      fix: "Check that the file isn't damaged, password-protected, or named with the wrong extension.",
      cause: error,
    });
  }
}

async function readBytes(path: string) {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new LiedarError("FILE_NOT_FOUND", `No file at ${path}`, { cause: error });
    }
    throw error;
  }
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

async function loadPdf(bytes: Uint8Array) {
  const loadingTask = getDocument({
    // pdf.js takes ownership of the buffer it's given, so pass a copy.
    data: bytes.slice(),
    standardFontDataUrl: join(PDFJS_DIRECTORY, "standard_fonts/"),
    cMapUrl: join(PDFJS_DIRECTORY, "cmaps/"),
    cMapPacked: true,
    verbosity: 0,
  });

  try {
    const document = await loadingTask.promise;
    const metadata = await readPdfMetadata(document, bytes);

    const pages: PageImage[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, MAX_PAGES); pageNumber++) {
      pages.push(await toPageImage(await renderPdfPage(await document.getPage(pageNumber)), "png"));
    }

    return { metadata, pages, totalPages: document.numPages };
  } finally {
    await loadingTask.destroy();
  }
}

async function readPdfMetadata(document: PDFDocumentProxy, bytes: Uint8Array) {
  const { info, metadata: xmp } = await document.getMetadata();
  const fields = info as Record<string, JSONValue | undefined>;

  return withoutEmptyValues({
    version: fields.PDFFormatVersion,
    encryption: fields.EncryptFilterName,
    title: fields.Title,
    author: fields.Author,
    subject: fields.Subject,
    keywords: fields.Keywords,
    creator: fields.Creator,
    producer: fields.Producer,
    creationDate: fields.CreationDate,
    modificationDate: fields.ModDate,
    pageCount: document.numPages,
    savedVersions: countSavedVersions(bytes, fields.IsLinearized === true),
    hasSignatures: fields.IsSignaturesPresent,
    hasForm: fields.IsAcroFormPresent,
    // XMP often names the editing tool and keeps a history of edits.
    xmp: xmp ? toJson(Object.fromEntries(xmp)) : undefined,
  });
}

/**
 * Each incremental save appends a new end-of-file marker, so more than one
 * version means the file was edited after it was first written. Linearized
 * ("fast web view") files start with an extra marker of their own.
 */
function countSavedVersions(bytes: Uint8Array, isLinearized: boolean) {
  const markers = Buffer.from(bytes).toString("latin1").split("%%EOF").length - 1;
  return Math.max(1, markers - (isLinearized ? 1 : 0));
}

/** Renders a page so its longest side is the largest Jev accepts, keeping small print legible. */
async function renderPdfPage(page: PDFPageProxy) {
  const { width, height } = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: MAX_SIDE_PIXELS / Math.max(width, height) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  // pdf.js is typed for a browser canvas; @napi-rs/canvas implements the same drawing API.
  await page.render({ canvas: canvas as unknown as RenderParameters["canvas"], viewport }).promise;
  return new Uint8Array(await canvas.encode("png"));
}

/** EXIF, TIFF, and XMP tags, such as the camera, editing software, and capture and edit dates. */
async function readImageMetadata(bytes: Uint8Array): Promise<JsonRecord> {
  const tags = await exifr.parse(bytes, { tiff: true, exif: true, xmp: true, gps: false }).catch(() => null);
  return tags ? toJson(tags) : {};
}

function withoutEmptyValues(record: Record<string, JSONValue | undefined>): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, JSONValue] => entry[1] !== undefined && entry[1] !== null && entry[1] !== "",
    ),
  );
}

/** Drops binary tag values (thumbnails, color profiles) and converts dates to strings. */
function toJson(tags: Record<string, unknown>): JsonRecord {
  return JSON.parse(
    JSON.stringify(tags, (_key, value) => (ArrayBuffer.isView(value) ? undefined : value)),
  );
}
