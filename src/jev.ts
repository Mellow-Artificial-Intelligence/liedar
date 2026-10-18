/**
 * A minimal client for asking Jev yes/no questions through TypeSafe's API.
 * https://docs.typesafe.ai/api
 */
import { errorMessage, LiedarError } from "./errors.ts";
import type { PageImage } from "./page-image.ts";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

/** Text and images, read by Jev in order. */
export type JevState = (string | PageImage)[];
export type JevQuestion = { instructions: string; criteria?: { true: string; false: string } };
/** `apiKey` defaults to TYPESAFE_AI_API_KEY; tests pass a mock `fetch`. */
export type JevOptions = { apiKey?: string; fetch?: typeof globalThis.fetch };

/** Ask every question against one shared state, returning each one's probability of "yes". */
export async function askJev<Key extends string>(
  state: JevState,
  questions: Record<Key, JevQuestion>,
  { apiKey = process.env.TYPESAFE_AI_API_KEY, fetch = globalThis.fetch }: JevOptions = {},
): Promise<Record<Key, number>> {
  if (!apiKey) {
    throw new LiedarError("MISSING_API_KEY", "TYPESAFE_AI_API_KEY is not set.", { fix: API_KEY_FIX });
  }
  const post = () =>
    fetch(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        // TypeSafe requires this opt-in while image input is experimental.
        "TypeSafe-Danger-Zone-Images": "true",
        // Every question reads every page image, which overflows the default 32k tokens per question past 6 pages.
        "TypeSafe-Danger-Zone-Long-Context": "true",
      },
      body: buildRequest(state, questions),
    }).catch((error: unknown) => {
      throw new LiedarError("JEV_REQUEST_FAILED", `Couldn't reach Jev: ${errorMessage(error)}`, { retryable: true, cause: error });
    });

  let response = await post();
  if (isRetryable(response.status)) {
    response = await post();
  }
  if (!response.ok) {
    throw await responseError(response);
  }

  const { answers } = (await response.json()) as { answers: Record<string, { noul?: number }> };
  return Object.fromEntries(
    Object.keys(questions).map((key) => {
      const probability = answers[key]?.noul;
      if (probability === undefined) {
        throw new LiedarError("JEV_BAD_RESPONSE", `Jev returned no answer for "${key}".`, { retryable: true });
      }
      return [key, probability];
    }),
  ) as Record<Key, number>;
}

const API_KEY_FIX =
  "Set TYPESAFE_AI_API_KEY in the environment or in a .env file in the working directory. Get a key at https://docs.typesafe.ai/api.";

function isRetryable(status: number) {
  return status === 429 || status >= 500;
}

async function responseError(response: Response) {
  const message = `Jev request failed (${response.status}): ${await response.text()}`;
  if (response.status === 401 || response.status === 403) {
    return new LiedarError("INVALID_API_KEY", message, { fix: API_KEY_FIX });
  }
  if (response.status === 429) {
    return new LiedarError("JEV_RATE_LIMITED", message, { fix: "Wait a minute, then try again.", retryable: true });
  }
  return new LiedarError("JEV_REQUEST_FAILED", message, { retryable: isRetryable(response.status) });
}


/** Images go as multipart files, each referenced from the state by a random ID so it can't match real text. */
function buildRequest(state: JevState, questions: Record<string, JevQuestion>): FormData {
  const assets: Record<string, { type: "image"; part: string }> = {};
  const images: Record<string, File> = {};
  const stateText = state.map((item, index) => {
    if (typeof item === "string") {
      return item;
    }
    const reference = crypto.randomUUID();
    const part = `image-${index}`;
    assets[reference] = { type: "image", part };
    images[part] = new File([item.data], `${part}.${item.mediaType.split("/")[1]}`, { type: item.mediaType });
    return reference;
  });

  const request = {
    model: JEV_MODEL,
    state: stateText.join("\n"),
    assets,
    questions: Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, { type: "noul", ...question }])),
  };
  const formData = new FormData();
  formData.append("request", new File([JSON.stringify(request)], "request.json", { type: "application/json" }));
  for (const [part, file] of Object.entries(images)) {
    formData.append(part, file);
  }
  return formData;
}
