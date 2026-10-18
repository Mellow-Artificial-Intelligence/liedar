import { describe, expect, test } from "bun:test";
import type { LoadedDocument } from "./document.ts";
import { checkDocument } from "./fraud-check.ts";
import { mockJev } from "./mock-jev.ts";

const apiKey = "test-key";

const DOCUMENT: LoadedDocument = {
  metadata: { pdf: { producer: "Adobe Photoshop", pageCount: 12 } },
  pages: [
    { mediaType: "image/png", data: new Uint8Array([1]) },
    { mediaType: "image/png", data: new Uint8Array([2]) },
  ],
  totalPages: 12,
};

describe("checkDocument", () => {
  test("sends the metadata and every page image as one state", async () => {
    const { fetch, requests } = mockJev({});
    await checkDocument(DOCUMENT, { apiKey, fetch });

    const { body, images } = requests[0]!;
    const [intro, metadata, ...pageReferences] = body.state.split("\n");
    expect(intro).toContain("first 2 of 12 pages");
    expect(JSON.parse(metadata!)).toEqual(DOCUMENT.metadata);
    expect(pageReferences.map((reference) => body.assets[reference]?.part)).toEqual(["image-2", "image-3"]);
    expect(images.map((image) => image.type)).toEqual(["image/png", "image/png"]);
  });

  test("reports signals above the threshold as reasons, most likely first", async () => {
    const { fetch } = mockJev({ likelyFraud: 0.82, modifiedAfterCreation: 0.6, editingSoftware: 0.95 });
    const report = await checkDocument(DOCUMENT, { apiKey, fetch });

    expect(report.likelyFraud).toBe(true);
    expect(report.fraudProbability).toBe(0.82);
    expect(report.reasons.map((reason) => [reason.key, reason.confidence])).toEqual([
      ["editingSoftware", 0.95],
      ["modifiedAfterCreation", 0.6],
    ]);
    expect(report.signals).toHaveLength(7);
  });

  test("reports an authentic document with no reasons", async () => {
    const { fetch } = mockJev({ likelyFraud: 0.04 });
    const report = await checkDocument(DOCUMENT, { apiKey, fetch });

    expect(report.likelyFraud).toBe(false);
    expect(report.reasons).toEqual([]);
  });
});
