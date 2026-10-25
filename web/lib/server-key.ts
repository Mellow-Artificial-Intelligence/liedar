import type { Provider } from "@liedar";

/** Availability only is sent to the browser; key values always stay on the server. */
export function getServerProviders(): Provider[] {
  return (["openai", "typesafe"] as const).filter((provider) => Boolean(getServerApiKey(provider)));
}

export function getServerApiKey(provider: Provider = "openai"): string | undefined {
  return process.env[provider === "typesafe" ? "TYPESAFE_AI_API_KEY" : "OPENAI_API_KEY"]?.trim() || undefined;
}
