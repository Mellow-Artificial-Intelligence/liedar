import { describe, expect, test } from "bun:test";
import { Experimental_DecisionMockModelV4 as DecisionMockModel } from "ai/test";
import type { LoadedDocument } from "./document";
import { checkDocument } from "./fraud-check";

const DOCUMENT: LoadedDocument = {
  metadata: { pdf: { producer: "Adobe Photoshop", pageCount: 12 } },
  pages: [
    { mediaType: "image/png", data: new Uint8Array([1]) },
    { mediaType: "image/png", data: new Uint8Array([2]) },
  ],
  totalPages: 12,
};

/** A mock Jev that answers every question with the given probabilities (0.1 when unlisted). */
function mockJev(probabilities: Record<string, number>) {
  const calls: Parameters<DecisionMockModel["doDecide"]>[0][] = [];
  const model = new DecisionMockModel({
    doDecide: async (options) => {
      calls.push(options);
      const answers = Object.fromEntries(
        Object.keys(options.questions).map((key) => [
          key,
          { type: "boolean" as const, probability: probabilities[key] ?? 0.1 },
        ]),
      );
      return { answers, warnings: [] };
    },
  });
  return { model, calls };
}

describe("checkDocument", () => {
  test("sends the metadata and every page image as one state", async () => {
    const { model, calls } = mockJev({});
    await checkDocument(DOCUMENT, { model });

    const state = calls[0]?.state ?? [];
    expect(state.map((part) => part.type)).toEqual(["text", "json", "file", "file"]);
    expect(state[0]).toMatchObject({ text: expect.stringContaining("first 2 of 12 pages") });
    expect(state[1]).toEqual({ type: "json", value: DOCUMENT.metadata });
  });

  test("reports signals above the threshold as reasons, most likely first", async () => {
    const { model } = mockJev({ likelyFraud: 0.82, modifiedAfterCreation: 0.6, editingSoftware: 0.95 });
    const report = await checkDocument(DOCUMENT, { model });

    expect(report.likelyFraud).toBe(true);
    expect(report.fraudProbability).toBe(0.82);
    expect(report.reasons.map((reason) => [reason.key, reason.confidence])).toEqual([
      ["editingSoftware", 0.95],
      ["modifiedAfterCreation", 0.6],
    ]);
    expect(report.signals).toHaveLength(7);
  });

  test("reports an authentic document with no reasons", async () => {
    const { model } = mockJev({ likelyFraud: 0.04 });
    const report = await checkDocument(DOCUMENT, { model });

    expect(report.likelyFraud).toBe(false);
    expect(report.reasons).toEqual([]);
  });
});
