import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Settings } from "@shared/settings";
import type { settingsPatchSchema } from "@shared/settings";
import type { z } from "zod";

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Dispatched on window after a successful settings save so the "Saved" indicator can light up. */
export const SETTINGS_SAVED_EVENT = "mailiq:settings-saved";

export async function fetchSettings(): Promise<Settings> {
  const res = await api.get<{ settings: Settings }>("/settings");
  return res.settings;
}

export type SettingsUpdateResult = { settings: Settings; onboarded?: boolean };

export async function updateSettings(patch: SettingsPatch): Promise<SettingsUpdateResult> {
  return api.patch<SettingsUpdateResult>("/settings", patch);
}

/**
 * Merge a successful settings PATCH into the session query cache.
 * Critical: `onboarded` lives on the session object (not inside settings), so it
 * must be copied explicitly — otherwise finishing onboarding navigates to /app/inbox
 * and AppLayout immediately bounces back to /app/onboarding.
 */
export function applySettingsToSession<T extends { settings?: Settings; onboarded?: boolean }>(
  prev: T | undefined,
  result: SettingsUpdateResult,
  patch: SettingsPatch,
): T | undefined {
  if (!prev) return prev;
  const onboarded =
    patch.onboarded !== undefined ? patch.onboarded : result.onboarded !== undefined ? result.onboarded : prev.onboarded;
  return { ...prev, settings: result.settings, onboarded };
}

/**
 * React Query mutation that patches user settings, updates the session cache, and
 * fires SETTINGS_SAVED_EVENT for the UI "Saved" indicator.
 */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => updateSettings(patch),
    onSuccess: (result, patch) => {
      qc.setQueryData(["session"], (prev: { settings?: Settings; onboarded?: boolean } | undefined) =>
        applySettingsToSession(prev, result, patch),
      );
      window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
    },
  });
}
