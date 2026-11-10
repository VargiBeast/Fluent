import { afterEach, describe, expect, it } from "vitest";
import { aiApiKey, aiConfigured, aiProvider, resetEnv } from "../../server/env.js";
import { aiModelId } from "../../server/ai/core.js";

const KEYS = ["AI_PROVIDER", "AI_MODEL", "GOOGLE_GENERATIVE_AI_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(v: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, v);
  resetEnv();
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnv();
});

describe("AI provider selection", () => {
  it("defaults to Google Gemini (gemini-2.5-flash) when the Gemini key is set", () => {
    setEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "g", XAI_API_KEY: "x" });
    expect(aiProvider()).toBe("google");
    expect(aiModelId()).toBe("gemini-2.5-flash");
    expect(aiApiKey()).toBe("g");
    expect(aiConfigured()).toBe(true);
  });

  it("falls back to xAI, then OpenAI, when only that key is set", () => {
    setEnv({ XAI_API_KEY: "x" });
    expect(aiProvider()).toBe("xai");
    expect(aiModelId()).toBe("grok-4.7");
    setEnv({ OPENAI_API_KEY: "o" });
    expect(aiProvider()).toBe("openai");
  });

  it("honours an explicit AI_PROVIDER even when a Gemini key exists", () => {
    setEnv({ AI_PROVIDER: "xai", GOOGLE_GENERATIVE_AI_API_KEY: "g", XAI_API_KEY: "x" });
    expect(aiProvider()).toBe("xai");
    expect(aiApiKey()).toBe("x");
  });

  it("is not configured when the selected provider has no key", () => {
    setEnv({ AI_PROVIDER: "xai", GOOGLE_GENERATIVE_AI_API_KEY: "g" });
    expect(aiConfigured()).toBe(false);
    setEnv({});
    expect(aiProvider()).toBe("google");
    expect(aiConfigured()).toBe(false);
    setEnv({ AI_PROVIDER: "", GOOGLE_GENERATIVE_AI_API_KEY: "" });
    expect(aiProvider()).toBe("google");
    expect(aiConfigured()).toBe(false);
  });

  it("uses AI_MODEL as an override and rejects unknown providers", () => {
    setEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "g", AI_MODEL: "gemini-2.5-pro" });
    expect(aiModelId()).toBe("gemini-2.5-pro");
    setEnv({ AI_PROVIDER: "claude" });
    expect(() => aiProvider()).toThrow();
  });
});
