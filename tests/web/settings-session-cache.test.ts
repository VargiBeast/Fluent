import { describe, expect, it } from "vitest";
import { applySettingsToSession, type SettingsUpdateResult } from "../../web/src/lib/settings";
import type { Settings } from "../../shared/settings";

const baseSettings = { appearance: { theme: "dark" } } as Settings;

describe("applySettingsToSession", () => {
  it("sets onboarded true when finishing onboarding (patch wins)", () => {
    const prev = { user: { id: "u1" }, onboarded: false, settings: baseSettings };
    const result: SettingsUpdateResult = { settings: baseSettings, onboarded: true };
    const next = applySettingsToSession(prev, result, { onboarded: true });
    expect(next?.onboarded).toBe(true);
    expect(next?.settings).toBe(baseSettings);
  });

  it("keeps prior onboarded when the patch does not touch it", () => {
    const prev = { onboarded: true, settings: baseSettings };
    const result: SettingsUpdateResult = { settings: baseSettings };
    const next = applySettingsToSession(prev, result, { appearance: { theme: "light" } });
    expect(next?.onboarded).toBe(true);
  });

  it("uses response onboarded when patch omits the field but server returns it", () => {
    const prev = { onboarded: false, settings: baseSettings };
    const result: SettingsUpdateResult = { settings: baseSettings, onboarded: true };
    const next = applySettingsToSession(prev, result, {});
    expect(next?.onboarded).toBe(true);
  });

  it("returns undefined when there is no prior session cache entry", () => {
    expect(applySettingsToSession(undefined, { settings: baseSettings, onboarded: true }, { onboarded: true })).toBeUndefined();
  });
});
