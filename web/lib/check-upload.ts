import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { loadDocument, checkDocument, LiedarError, type Provider } from "@liedar";
import { getServerApiKey, getServerProviders } from "./server-key";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

async function reviewDocument(path: string, apiKey: string, provider: Provider) {
  const document = await loadDocument(path);
  return { report: await checkDocument(document, { apiKey, provider }), metadata: document.metadata, analysis: document.analysis };
}

/** A raw upload is bounded while streaming, before document parsing or an API request. */
export function createUploadHandler(review = reviewDocument, serverApiKey = getServerApiKey) {
  return async function POST(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
    if (origin && origin !== expectedOrigin) return failure("This upload must come from the document checker.", 403);
    const authorization = request.headers.get("authorization");
    const provider = url.searchParams.get("provider") ?? (authorization !== null ? "openai" : getServerProviders()[0] ?? "openai");
    if (provider !== "openai" && provider !== "typesafe") return failure("Choose OpenAI or TypeSafe.", 400);
    // An explicitly supplied key wins, including its failures; never silently bill the server instead.
    const apiKey = authorization === null ? serverApiKey(provider) : authorization.match(/^Bearer (\S+)$/)?.[1];
    if (!apiKey || apiKey.length > 1024) return failure("Add an API key for the selected provider to check a document.", 401);
    if (request.headers.get("content-type") !== "application/octet-stream") return failure("Choose a PDF, PNG, or JPEG document.", 415);
    const name = url.searchParams.get("name") ?? "";
    const extension = extname(name).toLowerCase();
    if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(extension)) return failure("Choose a PDF, PNG, or JPEG document.", 415);
    if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES) return failure("Choose a file smaller than 20 MB.", 413);
    if (!request.body) return failure("The file is empty. Choose another document.", 400);

    let directory: string | undefined;
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_UPLOAD_BYTES) {
            await reader.cancel();
            return failure("Choose a file smaller than 20 MB.", 413);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (!size) return failure("The file is empty. Choose another document.", 400);
      directory = await mkdtemp(join(tmpdir(), "liedar-upload-"));
      // Never use an uploaded filename as a filesystem path.
      const path = join(directory, `document${extension}`);
      await writeFile(path, Buffer.concat(chunks));
      const result = await review(path, apiKey, provider);
      return Response.json({ schemaVersion: 2, ...result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof LiedarError) {
        // Provider bodies can contain operational details; keep those out of the browser.
        const message = error.code === "MISSING_API_KEY" || error.code === "INVALID_API_KEY"
          ? "Your selected provider’s API key was rejected. Update it and try again."
          : (error.code.startsWith("OPENAI_") || error.code.startsWith("JEV_"))
            ? "The document check could not finish. Please try again in a moment."
            : "This document could not be read. Check that it opens normally and isn't password-protected.";
        return failure(message, error.code === "INVALID_DOCUMENT" ? 422 : error.code === "INVALID_API_KEY" ? 401 : 502);
      }
      return failure("The document check could not finish. Please try again.", 500);
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };
}

function failure(message: string, status: number) {
  return Response.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}
