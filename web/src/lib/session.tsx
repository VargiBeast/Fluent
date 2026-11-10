import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setCsrfToken } from "./api";
import type { Settings } from "@shared/settings";

export interface Account {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  status: "active" | "needs_reauth" | "insufficient_scopes" | string;
  scopes: string[];
  color: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
  /** gmail | imap | outlook; older servers omit it (Gmail). */
  provider?: "gmail" | "imap" | "outlook";
  /** Gmail-only features are hidden where this says false. */
  capabilities?: { categories: boolean; labels: boolean; filters: boolean; sendAs: boolean; importance: boolean };
}

export interface SessionData {
  user: { id: string; email: string; name: string; picture: string | null } | null;
  csrfToken?: string;
  onboarded?: boolean;
  settings?: Settings;
  accounts?: Account[];
}

export interface ServerConfig {
  google: boolean;
  ai: boolean;
  database: boolean;
  aiProvider: string;
  aiModel?: string;
}

const Ctx = createContext<{ session: SessionData | undefined; config: ServerConfig | undefined; loading: boolean; refresh: () => Promise<void> } | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const s = await api.get<SessionData>("/auth/session");
      setCsrfToken(s.csrfToken);
      return s;
    },
    staleTime: 60_000,
  });
  const config = useQuery({ queryKey: ["config"], queryFn: () => api.get<ServerConfig>("/config"), staleTime: 300_000 });

  const theme = session.data?.settings?.appearance.theme ?? "dark";
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const accent = session.data?.settings?.appearance.accent ?? "purple";
  useEffect(() => {
    if (accent === "purple") delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = accent;
  }, [accent]);

  return (
    <Ctx.Provider
      value={{
        session: session.data,
        config: config.data,
        loading: session.isLoading,
        refresh: async () => {
          await qc.invalidateQueries({ queryKey: ["session"] });
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside provider");
  return v;
}
