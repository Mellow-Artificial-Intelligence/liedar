/** TypeSafe Jev adapter using the same predicates and native reliability rubric as OpenAI. */
import { RELIABILITY_QUESTION, parseDocumentAssessment, type DecisionState, type DecisionQuestion, type DecisionOptions } from "./assessment.ts";
import { LiedarError, errorMessage } from "./errors.ts";

export const JEV_MODEL = "jev-latest";
const API_KEY_FIX = "Set TYPESAFE_AI_API_KEY in the environment or .env, or supply a TypeSafe session key.";

export async function askDocumentJev<Key extends string>(state: DecisionState, questions: Record<Key, DecisionQuestion>, { apiKey = process.env.TYPESAFE_AI_API_KEY, fetch = globalThis.fetch }: DecisionOptions = {}) {
  if (!apiKey?.trim()) throw new LiedarError("MISSING_API_KEY", "TYPESAFE_AI_API_KEY is not set.", { fix: API_KEY_FIX });
  const post = () => fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "TypeSafe-Danger-Zone-Images": "true", "TypeSafe-Danger-Zone-Long-Context": "true" },
    body: buildRequest(state, questions),
  }).catch((cause: unknown) => {
    throw new LiedarError("JEV_REQUEST_FAILED", `Couldn't reach Jev: ${errorMessage(cause)}`, { retryable: true, cause });
  });
  let response = await post();
  if (response.status === 429 || response.status >= 500) response = await post();
  if (!response.ok) {
    const message = `Jev request failed (${response.status}): ${await response.text()}`;
    if (response.status === 401 || response.status === 403) throw new LiedarError("INVALID_API_KEY", message, { fix: API_KEY_FIX });
    throw new LiedarError(response.status === 429 ? "JEV_RATE_LIMITED" : "JEV_REQUEST_FAILED", message, { retryable: response.status === 429 || response.status >= 500 });
  }
  let payload: unknown;
  try { payload = await response.json(); } catch (cause) {
    throw new LiedarError("JEV_BAD_RESPONSE", "Jev returned invalid JSON.", { retryable: true, cause });
  }
  if (!isRecord(payload) || !isRecord(payload.answers)) throw new LiedarError("JEV_BAD_RESPONSE", "Jev returned no answer map.", { retryable: true });
  const answers = Object.entries(payload.answers).map(([name, answer]) => {
    if (!isRecord(answer)) return { name };
    return answer.type === "noul" ? { name, type: "predicate", probability: answer.noul } : { ...answer, name };
  });
  return parseDocumentAssessment({ answers }, Object.keys(questions) as Key[], "typesafe");
}

function buildRequest(state: DecisionState, questions: Record<string, DecisionQuestion>) {
  const form = new FormData();
  const assets: Record<string, { type: "image"; part: string }> = {};
  const images: { part: string; image: File }[] = [];
  const text = state.map((item, index) => {
    if (typeof item === "string") return item;
    const id = crypto.randomUUID();
    const part = `image-${index}`;
    assets[id] = { type: "image", part };
    images.push({ part, image: new File([new Uint8Array(item.data)], `${part}.${item.mediaType.split("/")[1]}`, { type: item.mediaType }) });
    return id;
  }).join("\n");
  form.append("request", new File([JSON.stringify({
    model: JEV_MODEL,
    state: text,
    assets,
    questions: {
      ...Object.fromEntries(Object.entries(questions).map(([name, question]) => [name, { type: "noul", instructions: question.instructions }])),
      [RELIABILITY_QUESTION.name]: { type: "score", instructions: RELIABILITY_QUESTION.instructions, criteria: RELIABILITY_QUESTION.levels.map(({ label, description }) => `${label}: ${description}`) },
    },
  })], "request.json", { type: "application/json" }));
  // TypeSafe requires the JSON request to be the first multipart part.
  for (const { part, image } of images) form.append(part, image);
  return form;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
