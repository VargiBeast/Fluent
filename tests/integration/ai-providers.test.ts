import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, startHarness, type Harness } from "./harness.js";
import { resetEnv } from "../../server/env.js";

let h: Harness;
let c: Client;
beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
});
afterAll(async () => { await h.close(); });

const rewrite = () => c.json<{ text: string }>("/api/ai/rewrite", { method: "POST", body: JSON.stringify({ text: "thx, thursday works", operation: "tone", tone: "formal" }) });

describe("AI providers over HTTP", () => {
  it("reports Gemini in /api/config by default", async () => {
    const cfg = await c.json<{ ai: boolean; aiProvider: string; aiModel: string }>("/api/config");
    expect(cfg.body).toMatchObject({ ai: true, aiProvider: "google", aiModel: "gemini-2.5-flash" });
  });

  it("calls Gemini generateContent with the API key header, guardrails and no thinking budget", async () => {
    const r = await rewrite();
    expect(r.status).toBe(200);
    expect(r.body.text).toContain("Thursday");
    const req = h.google.state.aiRequests.at(-1)!;
    expect(req.provider).toBe("google");
    expect(req.model).toBe("gemini-2.5-flash");
    expect(JSON.stringify(req.body.systemInstruction)).toContain("SECURITY RULES");
    expect(req.input).toContain("thx, thursday works");
    const gen = req.body.generationConfig as { responseMimeType?: string; thinkingConfig?: { thinkingBudget?: number } };
    expect(gen.responseMimeType).toBe("application/json");
    expect(gen.thinkingConfig?.thinkingBudget).toBe(0);
  });

  it("maps a Gemini failure to a friendly 502", async () => {
    h.google.state.aiFail = true;
    const r = await c.json<{ error: { code: string } }>("/api/ai/rewrite", { method: "POST", body: JSON.stringify({ text: "x", operation: "fix" }) });
    h.google.state.aiFail = false;
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe("ai_unavailable");
  });

  it("still supports xAI when AI_PROVIDER=xai", async () => {
    Object.assign(process.env, { AI_PROVIDER: "xai", XAI_API_KEY: "fake-xai-key" });
    resetEnv();
    try {
      expect((await c.json<{ aiProvider: string; aiModel: string }>("/api/config")).body).toMatchObject({ aiProvider: "xai", aiModel: "grok-4.7" });
      expect((await rewrite()).status).toBe(200);
      expect(h.google.state.aiRequests.at(-1)!.provider).toBe("xai");
    } finally {
      Object.assign(process.env, { AI_PROVIDER: "", XAI_API_KEY: "" });
      resetEnv();
    }
  });
});
