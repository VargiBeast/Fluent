import { api } from "./api";

export type UserSettings = {
  theme: "dark" | "light" | "system";
  accent: string;
  undoSendSeconds: number;
  aiEnabled: boolean;
  aiAutoSummarize: boolean;
  aiHistoryDays: number;
  // ... other fields
};

export async function fetchSettings(): Promise<UserSettings> {
  return api.get<UserSettings>("/api/settings");
}

export async function updateSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  return api.patch<UserSettings>("/api/settings", patch);
}
