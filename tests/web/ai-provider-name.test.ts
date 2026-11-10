import { describe, expect, it } from "vitest";
import { aiProviderName } from "../../web/src/lib/ai";

describe("aiProviderName", () => {
  it("names each provider and defaults to Gemini", () => {
    expect(aiProviderName("google")).toBe("Google Gemini");
    expect(aiProviderName("xai")).toBe("xAI Grok");
    expect(aiProviderName("openai")).toBe("OpenAI");
    expect(aiProviderName(undefined)).toBe("Google Gemini");
    expect(aiProviderName("other")).toBe("other");
  });
});
