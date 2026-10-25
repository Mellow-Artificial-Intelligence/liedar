import { describe, expect, test } from "bun:test";
import type { LoadedDocument } from "./document.ts";
import { checkDocument } from "./fraud-check.ts";
import { DECISIONS_MODEL } from "./decisions.ts";
import { mockDecisions } from "./mock-decisions.ts";

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
    const { fetch, requests } = mockDecisions({});
    await checkDocument(DOCUMENT, { apiKey, fetch });

    const content = requests[0]!.body.input[0]!.content;
    expect(content).toEqual([
      { type: "input_text", text: expect.stringContaining("first 2 of 12 pages") },
      { type: "input_text", text: JSON.stringify(DOCUMENT.metadata) },
      { type: "input_image", image_url: "data:image/png;base64,AQ==" },
      { type: "input_image", image_url: "data:image/png;base64,Ag==" },
      { type: "input_text", text: expect.stringContaining(JSON.stringify(DOCUMENT.analysis)) },
      { type: "input_text", text: expect.stringContaining("Close-up of copied region 1") },
      { type: "input_image", image_url: "data:image/png;base64,Aw==" },
    ]);
  });

  test("reports signals above the threshold as reasons, most likely first", async () => {
    const { fetch } = mockDecisions({ numbersDontReconcile: 0.8, visualTampering: 0.95, editingSoftware: 0.6 });
    const report = await checkDocument(DOCUMENT, { apiKey, fetch });

    expect(report.likelyFraud).toBe(true);
    expect(report.fraudProbability).toBe(0.95);
    expect(report.reasons.map((reason) => [reason.key, reason.confidence])).toEqual([
      ["visualTampering", 0.95],
      ["numbersDontReconcile", 0.8],
    ]);
    expect(report.reasons[0]?.question).toContain("localized evidence");
    expect(report.signals).toHaveLength(15);
    expect(report).toMatchObject({ threshold: 0.75, model: DECISIONS_MODEL, pagesChecked: 2, totalPages: 12 });
  });

  test("reports no flagged concerns without asserting authenticity", async () => {
    const { fetch } = mockDecisions({ visualTampering: 0.3 });
    const report = await checkDocument(DOCUMENT, { apiKey, fetch });

    expect(report.likelyFraud).toBe(false);
    expect(report.fraudProbability).toBe(0.3);
    expect(report.reasons).toEqual([]);
  });
  test("keeps provenance, synthesis clues, and quality concerns separate from fraud", async () => {
    const { fetch } = mockDecisions({ editingSoftware: 0.99, modifiedAfterCreation: 0.98, syntheticOrigin: 0.97, syntheticArtifacts: 0.9, unreadableDetails: 0.85, missingContext: 0.8, documentReliability: 2.3 });
    const report = await checkDocument(DOCUMENT, { apiKey, fetch });
    expect(report.likelyFraud).toBe(false);
    expect(report.fraudProbability).toBe(0.1);
    expect(report.reasons).toEqual([]);
    expect(report.reviewRequired).toBe(true);
    expect(report.reviewReasons).toHaveLength(6);
    expect(report.reliability).toEqual({ score: 2.3, maxScore: 4, confidence: 0.85, rubricVersion: 1 });
    expect(report.reviewReasons.find((reason) => reason.key === "syntheticOrigin")?.category).toBe("provenance");
    expect(report.reviewReasons.find((reason) => reason.key === "unreadableDetails")?.category).toBe("quality");
  });

  test("asks Decisions for every signal and a native overall rubric score in one request", async () => {
    const { fetch, requests } = mockDecisions({});
    await checkDocument(DOCUMENT, { apiKey, fetch });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.questions).toHaveLength(16);
    expect(requests[0]!.body.questions.find((question) => question.type === "score")).toMatchObject({ name: "documentReliability", levels: expect.any(Array) });
  });

});
