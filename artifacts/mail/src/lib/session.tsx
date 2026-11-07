import { useQuery } from "@tanstack/react-query";
import { api, type PublicUser, type SetupConfig } from "./api";

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ authenticated: boolean; user?: PublicUser }>("/api/auth/session"),
    retry: false,
  });
}

export function useSetup() {
  return useQuery({
    queryKey: ["setup"],
    queryFn: () => api<SetupConfig>("/api/auth/config"),
    retry: false,
  });
}
