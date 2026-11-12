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

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const res = await api.patch<{ settings: Settings }>("/settings", patch);
  return res.settings;
}

/**
 * React Query mutation that patches user settings, updates the session cache, and
 * fires SETTINGS_SAVED_EVENT for the UI "Saved" indicator.
 */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => updateSettings(patch),
    onSuccess: (settings) => {
      qc.setQueryData(["session"], (prev: { settings?: Settings } | undefined) =>
        prev ? { ...prev, settings } : prev,
      );
      window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
    },
  });
}
