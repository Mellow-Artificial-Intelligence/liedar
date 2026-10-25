import type { DecisionOptions, Provider } from "./assessment.ts";
import { LiedarError } from "./errors.ts";

export type CheckOptions = DecisionOptions & { provider?: Provider };
export const PROVIDER_ENV_NAMES = { openai: "OPENAI_API_KEY", typesafe: "TYPESAFE_AI_API_KEY" } as const;

/** Preserve OpenAI for a bare apiKey and when both environment keys exist. Never inspect key contents. */
export function resolveProvider(
  { provider, apiKey }: Pick<CheckOptions, "provider" | "apiKey"> = {},
  environment: Partial<Record<string, string | undefined>> = process.env,
): { provider: Provider; apiKey: string } {
  if (provider !== undefined && provider !== "openai" && provider !== "typesafe") {
    throw new LiedarError("USAGE", "Unknown provider. Choose openai or typesafe.");
  }
  const selected = provider ?? (apiKey !== undefined || environment.OPENAI_API_KEY?.trim() ? "openai" : environment.TYPESAFE_AI_API_KEY?.trim() ? "typesafe" : "openai");
  const key = apiKey !== undefined ? apiKey.trim() : environment[PROVIDER_ENV_NAMES[selected]]?.trim();
  if (!key) {
    throw new LiedarError("MISSING_API_KEY", `${PROVIDER_ENV_NAMES[selected]} is not set.`, {
      fix: `Set ${PROVIDER_ENV_NAMES[selected]} in the environment or in a .env file in the working directory, or pass apiKey and provider explicitly. Get a key at ${selected === "openai" ? "https://platform.openai.com/api-keys" : "https://docs.typesafe.ai/api"}.`,
    });
  }
  return { provider: selected, apiKey: key };
}
