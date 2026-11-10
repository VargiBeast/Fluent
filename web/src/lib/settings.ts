import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Settings, SettingsPatch } from "@shared/settings";
import { api, errorMessage } from "./api";
import type { SessionData } from "./session";

/** PATCH settings with an optimistic update of the cached session. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patch<{ settings: Settings }>("/settings", patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["session"] });
      const prev = qc.getQueryData<SessionData>(["session"]);
      if (prev?.settings) {
        const { onboarded, ...sections } = patch;
        const next = { ...prev.settings } as Record<string, object>;
        for (const [k, v] of Object.entries(sections)) next[k] = { ...next[k], ...v };
        qc.setQueryData<SessionData>(["session"], { ...prev, settings: next as Settings, onboarded: onboarded ?? prev.onboarded });
      }
      return { prev };
    },
    onError: (e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(["session"], ctx.prev);
      toast.error("Couldn't save settings", { description: errorMessage(e) });
    },
    onSuccess: (r, patch) => {
      qc.setQueryData<SessionData>(["session"], (s) => (s ? { ...s, settings: r.settings, onboarded: patch.onboarded ?? s.onboarded } : s));
      if (patch.ai || patch.privacy) void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}
