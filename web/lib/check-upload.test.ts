import { describe, expect, test } from "bun:test";
import { readFile, access } from "node:fs/promises";
import { buildPdf } from "../../src/test-pdf.ts";
import { loadDocument, checkDocument, LiedarError } from "@liedar";
import { mockDecisions } from "../../src/mock-decisions.ts";
import { createUploadHandler, MAX_UPLOAD_BYTES } from "./check-upload.ts";

function upload(body: BodyInit = buildPdf(), name = "invoice.pdf", headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/check?name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", Authorization: "Bearer test-session-key", ...headers }, body,
  });
}

describe("document upload", () => {
  test("checks a PDF using the existing pipeline and removes its temporary upload", async () => {
    let stagedPath = "";
    const handler = createUploadHandler(async (path, apiKey) => {
      expect(apiKey).toBe("test-session-key");
      stagedPath = path;
      expect(await readFile(path, "utf8")).toBe(buildPdf());
      const document = await loadDocument(path);
      const { fetch } = mockDecisions({ visualTampering: 0.9 });
      return { report: await checkDocument(document, { apiKey: "test-key", fetch }), metadata: document.metadata, analysis: document.analysis };
    });
    const response = await handler(upload(undefined, "../../invoice.pdf"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ schemaVersion: 2, report: { likelyFraud: true, model: "gpt-6-luna", pagesChecked: 1 } });
    await expect(access(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes uploads after a provider failure without exposing provider details", async () => {
    let stagedPath = "";
    const handler = createUploadHandler(async (path) => {
      stagedPath = path;
      throw new LiedarError("OPENAI_REQUEST_FAILED", "private provider error");
    });
    const response = await handler(upload());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider error");
    await expect(access(stagedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects cross-origin uploads, unsupported files, and empty files before review", async () => {
    const handler = createUploadHandler(async () => { throw new Error("review must not run"); });
    expect((await handler(upload(undefined, "invoice.pdf", { origin: "https://other.example" }))).status).toBe(403);
    expect((await handler(upload("text", "file.exe"))).status).toBe(415);
    expect((await handler(upload(""))).status).toBe(400);
    expect((await handler(upload("text", "file.pdf", { "Content-Type": "text/plain" }))).status).toBe(415);
  });

  test("accepts the browser origin when Next normalizes the request URL", async () => {
    const handler = createUploadHandler(async () => { throw new LiedarError("INVALID_DOCUMENT", "test"); });
    expect((await handler(upload(undefined, "invoice.pdf", { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).status).toBe(422);
  });

  test("requires a key when no server key is configured", async () => {
    const handler = createUploadHandler(async () => { throw new Error("review must not run"); }, () => undefined);
    const missingKey = upload();
    missingKey.headers.delete("authorization");
    expect((await handler(missingKey)).status).toBe(401);
    for (const authorization of ["", "Bearer ", "Basic secret"]) {
      const response = await handler(upload(undefined, "invoice.pdf", { authorization }));
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("secret");
    }
  });

  test("uses the server key automatically and lets a session key override it", async () => {
    const received: string[] = [];
    const handler = createUploadHandler(async (_path, apiKey) => {
      received.push(apiKey);
      throw new LiedarError("INVALID_DOCUMENT", "test");
    }, () => "test-server-key");
    const request = upload();
    request.headers.delete("authorization");
    const response = await handler(request);
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("test-server-key");
    expect((await handler(upload())).status).toBe(422);
    expect(received).toEqual(["test-server-key", "test-session-key"]);
  });

  test("does not fall back to the server key when an explicit session key is invalid", async () => {
    const handler = createUploadHandler(async () => { throw new Error("review must not run"); }, () => "test-server-key");
    expect((await handler(upload(undefined, "invoice.pdf", { authorization: "Basic invalid" }))).status).toBe(401);
    const rejected = createUploadHandler(async (_path, apiKey) => {
      expect(apiKey).toBe("test-session-key");
      throw new LiedarError("INVALID_API_KEY", "provider body");
    }, () => "test-server-key");
    expect((await rejected(upload())).status).toBe(401);
  });

  test("enforces the upload limit even without a content-length header", async () => {
    const handler = createUploadHandler(async () => { throw new Error("review must not run"); });
    expect((await handler(upload("x", "large.pdf", { "content-length": String(MAX_UPLOAD_BYTES + 1) }))).status).toBe(413);
    expect((await handler(upload(new Uint8Array(MAX_UPLOAD_BYTES + 1)))).status).toBe(413);
  });

  test("reports an unreadable document as a validation error", async () => {
    const handler = createUploadHandler(async (path) => {
      await loadDocument(path);
      throw new Error("must not reach review");
    });
    expect((await handler(upload("this is not a PDF"))).status).toBe(422);
  });
});
