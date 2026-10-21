import { describe, expect, test } from "bun:test";
import type { LoadedDocument } from "./document.ts";
import { checkDocument } from "./fraud-check.ts";
import { JEV_MODEL } from "./jev.ts";
import { mockJev } from "./mock-jev.ts";

const apiKey = "test-key";

const DOCUMENT: LoadedDocument = {
  metadata: { pdf: { producer: "Adobe Photoshop", pageCount: 12 } },
  pages: [
    { mediaType: "image/png", data: new Uint8Array([1]) },
    { mediaType: "image/png", data: new Uint8Array([2]) },
  ],
  totalPages: 12,
  analysis: {
    copiedRegions: {
      checked: true,
      copiedRegions: [
        {
          match: "exact",
          source: { left: 0.1, top: 0.2, width: 0.05, height: 0.02 },
          copy: { left: 0.6, top: 0.7, width: 0.05, height: 0.02 },
          matchingBlocks: 120,
        },
      ],
    },
  },
  closeUps: [{ mediaType: "image/png", data: new Uint8Array([3]) }],
};

describe("checkDocument", () => {
  test("sends the metadata, every page image, and the pixel analysis with its close-ups as one state", async () => {
    const { fetch, requests } = mockJev({});
    await checkDocument(DOCUMENT, { apiKey, fetch });

    const { body, images } = requests[0]!;
    const [intro, metadata, firstPage, secondPage, analysis, caption, closeUp] = body.state.split("\n");
    expect(intro).toContain("first 2 of 12 pages");
    expect(JSON.parse(metadata!)).toEqual(DOCUMENT.metadata);
    expect([firstPage, secondPage, closeUp].map((reference) => body.assets[reference!]?.part)).toEqual([
      "image-2",
      "image-3",
      "image-6",
    ]);
    expect(analysis).toContain(JSON.stringify(DOCUMENT.analysis));
    expect(caption).toContain("Close-up of copied region 1");
    expect(images.map((image) => image.type)).toEqual(["image/png", "image/png", "image/png"]);
  });

  test("reports signals above the threshold as reasons, most likely first", async () => {
    const { fetch } = mockJev({ modifiedAfterCreation: 0.8, editingSoftware: 0.95, visualTampering: 0.6 });
    const report = await checkDocument(DOCUMENT, { apiKey, fetch });

    expect(report.likelyFraud).toBe(true);
    expect(report.fraudProbability).toBe(0.95);
    expect(report.reasons.map((reason) => [reason.key, reason.confidence])).toEqual([
      ["editingSoftware", 0.95],
      ["modifiedAfterCreation", 0.8],
    ]);
    expect(report.reasons[0]?.question).toContain("editing software");
    expect(report.signals).toHaveLength(11);
    expect(report).toMatchObject({ threshold: 0.75, model: JEV_MODEL, pagesChecked: 2, totalPages: 12 });
  });

  test("reports an authentic document with no reasons", async () => {
    const { fetch } = mockJev({ visualTampering: 0.3 });
    const report = await checkDocument(DOCUMENT, { apiKey, fetch });

    expect(report.likelyFraud).toBe(false);
    expect(report.fraudProbability).toBe(0.3);
    expect(report.reasons).toEqual([]);
  });
});
