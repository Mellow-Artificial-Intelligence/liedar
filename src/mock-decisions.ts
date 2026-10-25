/** Mock Decisions transport: records requests and returns supplied failures before named probabilities. */
type DecisionRequest = {
  model: string;
  input: { role: string; content: ({ type: "input_text"; text: string } | { type: "input_image"; image_url: string })[] }[];
  questions: { type: string; name: string; instructions: string; levels?: { label: string; description: string }[] }[];
};

export function mockDecisions(probabilities: Record<string, number>, failures: Response[] = []) {
  const requests: { url: string; headers: Headers; body: DecisionRequest }[] = [];
  const fetch = (async (url, init) => {
    const body: DecisionRequest = JSON.parse(init!.body as string);
    requests.push({ url: String(url), headers: new Headers(init!.headers), body });
    const answers = body.questions.map(({ name, type }) => type === "score"
      ? { type: "score", name, score: probabilities[name] ?? 4, confidence: 0.85 }
      : { type: "predicate", name, probability: probabilities[name] ?? 0.1 });
    return failures.shift() ?? Response.json({ model: body.model, answers });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}
