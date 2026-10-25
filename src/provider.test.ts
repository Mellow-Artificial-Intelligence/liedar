import { expect, test } from "bun:test";
import { resolveProvider } from "./provider.ts";

test("selects the environment provider without guessing from key prefixes", () => {
  expect(resolveProvider({}, { TYPESAFE_AI_API_KEY: "type-key" })).toEqual({ provider: "typesafe", apiKey: "type-key" });
  expect(resolveProvider({}, { OPENAI_API_KEY: "open-key" })).toEqual({ provider: "openai", apiKey: "open-key" });
  expect(resolveProvider({}, { OPENAI_API_KEY: "open-key", TYPESAFE_AI_API_KEY: "type-key" }).provider).toBe("openai");
  expect(resolveProvider({ provider: "typesafe" }, { OPENAI_API_KEY: "open-key", TYPESAFE_AI_API_KEY: "type-key" }).apiKey).toBe("type-key");
  expect(resolveProvider({ apiKey: "not-a-recognizable-prefix" }, {}).provider).toBe("openai");
});

test("keeps an explicit key bound to its chosen provider", () => {
  expect(resolveProvider({ provider: "typesafe", apiKey: "session-key" }, { TYPESAFE_AI_API_KEY: "server-key" }).apiKey).toBe("session-key");
  expect(() => resolveProvider({ provider: "typesafe" }, { OPENAI_API_KEY: "open-key" })).toThrow("TYPESAFE_AI_API_KEY");
  expect(() => resolveProvider({ apiKey: "" }, { OPENAI_API_KEY: "server-key" })).toThrow("OPENAI_API_KEY");
  expect(() => resolveProvider({ provider: "other" as never }, {})).toThrow("Unknown provider");
});
