import { expect, test } from "bun:test";
import { askDocumentJev } from "./jev.ts";
import { checkDocument } from "./fraud-check.ts";
import { RELIABILITY_QUESTION } from "./assessment.ts";

function mockJev(overrides: Record<string, unknown> = {}, failures: Response[] = []) {
  const requests: { url: string; headers: Headers; form: FormData; body: { model: string; state: string; assets: Record<string, { part: string }>; questions: Record<string, { type: string; instructions: string; criteria?: string[] }> } }[] = [];
  const fetch = (async (url, init) => {
    const form = init!.body as FormData;
    const body = JSON.parse(await (form.get("request") as File).text());
    requests.push({ url: String(url), headers: new Headers(init!.headers), form, body });
    return failures.shift() ?? Response.json({ answers: Object.fromEntries(Object.entries(body.questions).map(([name, question]) => [name, overrides[name] ?? ((question as { type: string }).type === "score" ? { type: "score", score: 2.75, confidence: 0.6 } : { type: "noul", noul: 0.2 })])) });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}
const questions = { edited: { instructions: "Was it edited?" } };
const image = { mediaType: "image/jpeg", data: new Uint8Array([1, 2, 3]) } as const;

test("Jev sends images, predicates, and the shared native rubric in one multipart request", async () => {
  const { fetch, requests } = mockJev();
  const result = await askDocumentJev(["Evidence", image], questions, { apiKey: "test-key", fetch });
  expect(result).toEqual({ answers: { edited: 0.2 }, reliability: { score: 2.75, confidence: 0.6, maxScore: 4, rubricVersion: 1 } });
  const { url, headers, body, form } = requests[0]!;
  expect([...form.keys()][0]).toBe("request");
  expect(url).toBe("https://api.typesafe.ai/v1/systemone");
  expect(headers.get("Authorization")).toBe("Bearer test-key");
  expect(headers.get("TypeSafe-Danger-Zone-Images")).toBe("true");
  expect(headers.get("TypeSafe-Danger-Zone-Long-Context")).toBe("true");
  expect(body.questions.edited).toEqual({ type: "noul", instructions: "Was it edited?" });
  expect(body.questions.documentReliability?.criteria).toEqual(RELIABILITY_QUESTION.levels.map(({ label, description }) => `${label}: ${description}`));
  const reference = body.state.split("\n")[1]!;
  expect(body.assets[reference]?.part).toBe("image-1");
  expect(new Uint8Array(await (form.get("image-1") as File).arrayBuffer())).toEqual(image.data);
});

test.each([429, 503])("Jev retries status %d once", async (status) => {
  const { fetch, requests } = mockJev({}, [new Response("busy", { status })]);
  await askDocumentJev(["text"], questions, { apiKey: "test", fetch });
  expect(requests).toHaveLength(2);
});

test.each([
  { status: 400, code: "JEV_REQUEST_FAILED", attempts: 1 },
  { status: 401, code: "INVALID_API_KEY", attempts: 1 },
  { status: 403, code: "INVALID_API_KEY", attempts: 1 },
  { status: 429, code: "JEV_RATE_LIMITED", attempts: 2 },
  { status: 503, code: "JEV_REQUEST_FAILED", attempts: 2 },
])("Jev classifies $status failures without changing providers", async ({ status, code, attempts }) => {
  const { fetch, requests } = mockJev({}, [new Response("failure", { status }), new Response("failure", { status })]);
  await expect(askDocumentJev(["text"], questions, { apiKey: "test", fetch })).rejects.toMatchObject({ code });
  expect(requests).toHaveLength(attempts);
});

test.each([
  { edited: { type: "noul", noul: -0.1 } },
  { edited: { type: "noul", noul: 1.1 } },
  { edited: { type: "noul", noul: "0.5" } },
  { edited: { type: "refusal" } },
  { documentReliability: { type: "score", score: 5, confidence: 0.5 } },
  { documentReliability: { type: "score", score: 2, confidence: null } },
])("Jev validates every model answer: %j", async (overrides) => {
  const { fetch } = mockJev(overrides);
  await expect(askDocumentJev(["text"], questions, { apiKey: "test", fetch })).rejects.toMatchObject({ code: "JEV_BAD_RESPONSE" });
});

test("Jev rejects malformed JSON, missing answers, missing keys and network failures", async () => {
  for (const response of [new Response("not JSON"), Response.json({}), Response.json({ answers: {} })]) {
    const { fetch } = mockJev({}, [response]);
    await expect(askDocumentJev(["text"], questions, { apiKey: "test", fetch })).rejects.toMatchObject({ code: "JEV_BAD_RESPONSE" });
  }
  const { fetch, requests } = mockJev();
  await expect(askDocumentJev(["text"], questions, { apiKey: "", fetch })).rejects.toMatchObject({ code: "MISSING_API_KEY" });
  expect(requests).toHaveLength(0);
  const failedFetch = (async () => { throw new TypeError("offline"); }) as unknown as typeof globalThis.fetch;
  await expect(askDocumentJev(["text"], questions, { apiKey: "test", fetch: failedFetch })).rejects.toMatchObject({ code: "JEV_REQUEST_FAILED", retryable: true });
});

test("Jev produces the same public scoring contract with explicit provider attribution", async () => {
  const { fetch, requests } = mockJev();
  const report = await checkDocument({ metadata: {}, pages: [image], totalPages: 1, analysis: { copiedRegions: { checked: false, reason: "test" } }, closeUps: [] }, { provider: "typesafe", apiKey: "test", fetch });
  expect(report).toMatchObject({ provider: "typesafe", model: "jev-latest", reliability: { score: 2.75, maxScore: 4, confidence: 0.6, rubricVersion: 1 } });
  expect(report.signals).toHaveLength(15);
  expect(requests).toHaveLength(1);
});
