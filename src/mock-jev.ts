/**
 * A mock of TypeSafe's API for tests: returns each failure in turn, then answers
 * every question with the given probability (0.1 when unlisted). Records each request.
 */
type JevRequest = {
  model: string;
  state: string;
  assets: Record<string, { type: "image"; part: string }>;
  questions: Record<string, { type: string; instructions: string }>;
};

export function mockJev(probabilities: Record<string, number>, failures: Response[] = []) {
  const requests: { headers: Headers; body: JevRequest; images: File[] }[] = [];
  const fetch = (async (_url, init) => {
    const formData = init!.body as FormData;
    const body: JevRequest = JSON.parse(await (formData.get("request") as File).text());
    const images = Object.values(body.assets).map(({ part }) => formData.get(part) as File);
    requests.push({ headers: new Headers(init!.headers), body, images });

    const answers = Object.keys(body.questions).map((key) => [key, { type: "noul", noul: probabilities[key] ?? 0.1 }]);
    return failures.shift() ?? Response.json({ model: body.model, answers: Object.fromEntries(answers) });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}
