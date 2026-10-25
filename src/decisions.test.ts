import { describe, expect, test } from "bun:test";
import { askDecisions, askDocumentDecisions, DECISIONS_MODEL } from "./decisions.ts";
import { mockDecisions } from "./mock-decisions.ts";

const QUESTIONS = { isCat: { instructions: "Does the image show a cat?" } };
const IMAGE = { mediaType: "image/jpeg", data: new Uint8Array([1, 2, 3]) } as const;
const apiKey = "test-key";

describe("askDecisions", () => {
  test("sends yes/no questions and images in OpenAI's JSON format", async () => {
    const { fetch, requests } = mockDecisions({ isCat: 0.97 });
    expect(await askDecisions(["A photo:", IMAGE], QUESTIONS, { apiKey, fetch })).toEqual({ isCat: 0.97 });

    const { url, headers, body } = requests[0]!;
    expect(url).toBe("https://api.openai.com/v1/decisions");
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(body).toEqual({
      model: DECISIONS_MODEL,
      input: [{ role: "user", content: [
        { type: "input_text", text: "A photo:" },
        { type: "input_image", image_url: "data:image/jpeg;base64,AQID" },
      ] }],
      questions: [{ type: "predicate", name: "isCat", ...QUESTIONS.isCat }],
    });
  });

  test("retries once after a server error", async () => {
    const { fetch, requests } = mockDecisions({ isCat: 0.2 }, [new Response("busy", { status: 503 })]);
    expect(await askDecisions(["text"], QUESTIONS, { apiKey, fetch })).toEqual({ isCat: 0.2 });
    expect(requests).toHaveLength(2);
  });

  test("reports OpenAI's error without retrying a bad request", async () => {
    const { fetch, requests } = mockDecisions({}, [Response.json({ error: "Image too large" }, { status: 400 })]);
    await expect(askDecisions(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({
      code: "OPENAI_REQUEST_FAILED",
      message: expect.stringContaining("(400): {\"error\":\"Image too large\"}"),
      retryable: false,
    });
    expect(requests).toHaveLength(1);
  });

  test("marks a rate limit that outlasts the retry as retryable", async () => {
    const rateLimited = () => new Response("slow down", { status: 429 });
    const { fetch, requests } = mockDecisions({}, [rateLimited(), rateLimited()]);
    await expect(askDecisions(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({
      code: "OPENAI_RATE_LIMITED",
      retryable: true,
    });
    expect(requests).toHaveLength(2);
  });

  test("tells a rejected API key apart from other failures", async () => {
    const { fetch } = mockDecisions({}, [new Response("bad key", { status: 401 })]);
    await expect(askDecisions(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  test("reports a network failure as retryable", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    await expect(askDecisions(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({
      code: "OPENAI_REQUEST_FAILED",
      message: "Couldn't reach OpenAI: fetch failed",
      retryable: true,
    });
  });

  test("explains a missing API key before sending anything", async () => {
    const { fetch, requests } = mockDecisions({});
    await expect(askDecisions(["text"], QUESTIONS, { apiKey: "", fetch })).rejects.toMatchObject({
      code: "MISSING_API_KEY",
      fix: expect.stringContaining("https://platform.openai.com/api-keys"),
    });
    expect(requests).toHaveLength(0);
  });

  test("matches answers by name rather than array order", async () => {
    const { fetch } = mockDecisions({}, [Response.json({ answers: [
      { type: "predicate", name: "second", probability: 0 },
      { type: "predicate", name: "isCat", probability: 1 },
    ] })]);
    expect(await askDecisions(["text"], { ...QUESTIONS, second: { instructions: "Another question?" } }, { apiKey, fetch }))
      .toEqual({ isCat: 1, second: 0 });
  });

  test.each([
    null, {}, { answers: {} }, { answers: [] }, { answers: [null] },
    { answers: [{ type: "refusal", name: "isCat" }] },
    { answers: [{ type: "choice", name: "isCat", probability: 0.5 }] },
    ...[undefined, null, "0.5", -0.1, 1.1].map((probability) => ({ answers: [{ type: "predicate", name: "isCat", probability }] })),
    { answers: [{ type: "predicate", name: "isCat", probability: 0.5 }, { type: "predicate", name: "isCat", probability: 0.6 }] },
  ])("rejects malformed, refused, or ambiguous answers: %j", async (payload) => {
    const { fetch } = mockDecisions({}, [Response.json(payload)]);
    await expect(askDecisions(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({ code: "OPENAI_BAD_RESPONSE" });
  });

  test("reports invalid response JSON explicitly", async () => {
    const { fetch } = mockDecisions({}, [new Response("not json")]);
    await expect(askDecisions(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({ code: "OPENAI_BAD_RESPONSE" });
  });
});

describe("document reliability score", () => {
  const predicate = { type: "predicate", name: "isCat", probability: 0.2 };
  test("preserves the model's score and confidence", async () => {
    const { fetch } = mockDecisions({}, [Response.json({ answers: [predicate, { type: "score", name: "documentReliability", score: 2.75, confidence: 0.62 }] })]);
    const result = await askDocumentDecisions(["text"], QUESTIONS, { apiKey, fetch });
    expect(result.answers).toEqual({ isCat: 0.2 });
    expect(result.reliability).toEqual({ score: 2.75, confidence: 0.62, maxScore: 4, rubricVersion: 1 });
  });
  test.each([
    undefined,
    { type: "refusal", name: "documentReliability" },
    ...[-1, 4.1, "2", null].map((score) => ({ type: "score", name: "documentReliability", score, confidence: 0.5 })),
    ...[undefined, -0.1, 1.1].map((confidence) => ({ type: "score", name: "documentReliability", score: 3, confidence })),
  ])("rejects an absent, refused, or invalid score: %j", async (score) => {
    const { fetch } = mockDecisions({}, [Response.json({ answers: score ? [predicate, score] : [predicate] })]);
    await expect(askDocumentDecisions(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({ code: "OPENAI_BAD_RESPONSE" });
  });
});
