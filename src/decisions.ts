/** Minimal client for OpenAI's Decisions API. */
import { Buffer } from "node:buffer";
import { errorMessage, LiedarError } from "./errors.ts";
import { RELIABILITY_QUESTION, parseDocumentAssessment, parsePredicateAnswers, type DecisionState, type DecisionQuestion, type DecisionOptions, type ReliabilityScore } from "./assessment.ts";
export type { DecisionOptions, ReliabilityScore } from "./assessment.ts";

const DECISIONS_URL = "https://api.openai.com/v1/decisions";
export const DECISIONS_MODEL = "gpt-6-luna";

/** Ask each predicate against shared evidence, returning its probability of being true. */
export async function askDecisions<Key extends string>(
  state: DecisionState,
  questions: Record<Key, DecisionQuestion>,
  { apiKey = process.env.OPENAI_API_KEY, fetch = globalThis.fetch }: DecisionOptions = {},
): Promise<Record<Key, number>> {
  const payload = await requestDecision(state, predicateQuestions(questions), { apiKey, fetch });
  return parsePredicateAnswers(payload, Object.keys(questions) as Key[]);
}

/** All signal probabilities and the overall rubric score come from the same Decisions request. */
export async function askDocumentDecisions<Key extends string>(
  state: DecisionState,
  questions: Record<Key, DecisionQuestion>,
  options: DecisionOptions = {},
): Promise<{ answers: Record<Key, number>; reliability: ReliabilityScore }> {
  const payload = await requestDecision(state, [...predicateQuestions(questions), RELIABILITY_QUESTION], options);
  return parseDocumentAssessment(payload, Object.keys(questions) as Key[], "openai");
}

function predicateQuestions<Key extends string>(questions: Record<Key, DecisionQuestion>) {
  return (Object.keys(questions) as Key[]).map((name) => ({ type: "predicate", name, instructions: questions[name].instructions }));
}

async function requestDecision(
  state: DecisionState,
  questions: unknown[],
  { apiKey = process.env.OPENAI_API_KEY, fetch = globalThis.fetch }: DecisionOptions = {},
): Promise<unknown> {
  if (!apiKey?.trim()) {
    throw new LiedarError("MISSING_API_KEY", "OPENAI_API_KEY is not set.", { fix: API_KEY_FIX });
  }
  const body = JSON.stringify({
    model: DECISIONS_MODEL,
    input: [{
      role: "user",
      content: state.map((item) => typeof item === "string"
        ? { type: "input_text", text: item }
        : { type: "input_image", image_url: `data:${item.mediaType};base64,${Buffer.from(item.data).toString("base64")}` }),
    }],
    questions,
  });
  const post = () => fetch(DECISIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body,
  }).catch((error: unknown) => {
    throw new LiedarError("OPENAI_REQUEST_FAILED", `Couldn't reach OpenAI: ${errorMessage(error)}`, { retryable: true, cause: error });
  });

  let response = await post();
  if (isRetryable(response.status)) {
    response = await post();
  }
  if (!response.ok) {
    throw await responseError(response);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new LiedarError("OPENAI_BAD_RESPONSE", "OpenAI returned invalid JSON.", { retryable: true, cause });
  }
  return payload;
}

const API_KEY_FIX =
  "Set OPENAI_API_KEY in the environment or in a .env file in the working directory. Get a key at https://platform.openai.com/api-keys.";

function isRetryable(status: number) {
  return status === 429 || status >= 500;
}

async function responseError(response: Response) {
  const message = `OpenAI request failed (${response.status}): ${await response.text()}`;
  if (response.status === 401 || response.status === 403) {
    return new LiedarError("INVALID_API_KEY", message, { fix: API_KEY_FIX });
  }
  if (response.status === 429) {
    return new LiedarError("OPENAI_RATE_LIMITED", message, { fix: "Wait a minute, then try again.", retryable: true });
  }
  return new LiedarError("OPENAI_REQUEST_FAILED", message, { retryable: isRetryable(response.status) });
}
