import { describe, expect, it } from "vitest";
import { safeNext } from "../../server/routes/auth.js";
import { parseSettings, settingsPatchSchema } from "../../shared/settings.js";

describe("safeNext (open-redirect protection)", () => {
  it.each([
    ["/app/inbox", "/app/inbox"],
    [undefined, "/app"],
    ["https://evil.example", "/app"],
    ["//evil.example", "/app"],
    ["/\\evil.example", "/app"],
    ["/x?u=https://evil", "/app"],
  ])("%s -> %s", (input, out) => {
    expect(safeNext(input)).toBe(out);
  });
});

describe("settings schema", () => {
  it("fills defaults", () => {
    const s = parseSettings({});
    expect(s.appearance.theme).toBe("dark");
    expect(s.privacy.loadRemoteImages).toBe("ask");
    expect(s.ai.excludedSenders).toEqual([]);
  });
  it("falls back to defaults on corrupt data", () => {
    expect(parseSettings({ appearance: { theme: 42 } }).appearance.theme).toBe("dark");
  });
  it("patches without injecting defaults and rejects unknown keys", () => {
    expect(settingsPatchSchema.parse({ ai: { tone: "warm" } })).toEqual({ ai: { tone: "warm" } });
    expect(() => settingsPatchSchema.parse({ ai: { admin: true } })).toThrow();
    expect(settingsPatchSchema.parse({ ai: { excludedSenders: [" Boss@Corp.Example "] } }).ai?.excludedSenders).toEqual(["boss@corp.example"]);
  });
});
