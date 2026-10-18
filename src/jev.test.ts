import { describe, expect, test } from "bun:test";
import { askJev, JEV_MODEL } from "./jev.ts";
import { mockJev } from "./mock-jev.ts";

const QUESTIONS = { isCat: { instructions: "Does the image show a cat?" } };
const IMAGE = { mediaType: "image/jpeg", data: new Uint8Array([1, 2, 3]) } as const;
const apiKey = "test-key";

describe("askJev", () => {
  test("sends yes/no questions and images in TypeSafe's multipart format", async () => {
    const { fetch, requests } = mockJev({ isCat: 0.97 });
    expect(await askJev(["A photo:", IMAGE], QUESTIONS, { apiKey, fetch })).toEqual({ isCat: 0.97 });

    const { headers, body, images } = requests[0]!;
    const [text, reference] = body.state.split("\n");
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("TypeSafe-Danger-Zone-Images")).toBe("true");
    expect(body.model).toBe(JEV_MODEL);
    expect(body.questions.isCat).toEqual({ type: "noul", ...QUESTIONS.isCat });
    expect(text).toBe("A photo:");
    expect(body.assets[reference!]).toEqual({ type: "image", part: "image-1" });
    expect(images[0]!.type).toBe("image/jpeg");
    expect(new Uint8Array(await images[0]!.arrayBuffer())).toEqual(IMAGE.data);
  });

  test("retries once after a server error", async () => {
    const { fetch, requests } = mockJev({ isCat: 0.2 }, [new Response("busy", { status: 503 })]);
    expect(await askJev(["text"], QUESTIONS, { apiKey, fetch })).toEqual({ isCat: 0.2 });
    expect(requests).toHaveLength(2);
  });

  test("reports TypeSafe's error without retrying a bad request", async () => {
    const { fetch, requests } = mockJev({}, [Response.json({ error: "Image too large" }, { status: 400 })]);
    await expect(askJev(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({
      code: "JEV_REQUEST_FAILED",
      message: expect.stringContaining("(400): {\"error\":\"Image too large\"}"),
      retryable: false,
    });
    expect(requests).toHaveLength(1);
  });

  test("marks a rate limit that outlasts the retry as retryable", async () => {
    const rateLimited = () => new Response("slow down", { status: 429 });
    const { fetch, requests } = mockJev({}, [rateLimited(), rateLimited()]);
    await expect(askJev(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({
      code: "JEV_RATE_LIMITED",
      retryable: true,
    });
    expect(requests).toHaveLength(2);
  });

  test("tells a rejected API key apart from other failures", async () => {
    const { fetch } = mockJev({}, [new Response("bad key", { status: 401 })]);
    await expect(askJev(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  test("reports a network failure as retryable", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    await expect(askJev(["text"], QUESTIONS, { apiKey, fetch })).rejects.toMatchObject({
      code: "JEV_REQUEST_FAILED",
      message: "Couldn't reach Jev: fetch failed",
      retryable: true,
    });
  });

  test("explains a missing API key before sending anything", async () => {
    const { fetch, requests } = mockJev({});
    await expect(askJev(["text"], QUESTIONS, { apiKey: "", fetch })).rejects.toMatchObject({
      code: "MISSING_API_KEY",
      fix: expect.stringContaining("https://docs.typesafe.ai/api"),
    });
    expect(requests).toHaveLength(0);
  });
});
