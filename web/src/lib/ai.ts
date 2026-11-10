const AI_PROVIDER_NAMES: Record<string, string> = { google: "Google Gemini", xai: "xAI Grok", openai: "OpenAI" };

/** Human-readable AI provider name for UI copy. */
export function aiProviderName(provider: string | undefined): string {
  return AI_PROVIDER_NAMES[provider ?? "google"] ?? provider ?? "Google Gemini";
}
