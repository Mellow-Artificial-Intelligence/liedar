/** Only call on the server. Send key availability, never the key, to the UI. */
export function getServerApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}
