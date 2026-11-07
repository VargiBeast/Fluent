import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/fluent/shell";
import { api } from "@/lib/api";
import { useSession, useSetup } from "@/lib/session";
import { useLocation } from "wouter";

export function SettingsPage() {
  const session = useSession();
  const setup = useSetup();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const gmail = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () =>
      api<{ connected: boolean; status: string; email: string | null; scopeIncludesSend: boolean; applicationSendEnabled: boolean }>(
        "/api/gmail/status",
      ),
  });
  const prefs = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api<{ loadRemoteImages: boolean; timezone: string }>("/api/preferences"),
  });
  const savePrefs = useMutation({
    mutationFn: (loadRemoteImages: boolean) =>
      api("/api/preferences", { method: "PUT", body: JSON.stringify({ loadRemoteImages }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["preferences"] }),
  });
  const disconnect = useMutation({
    mutationFn: () => api("/api/gmail/disconnect", { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gmail-status"] }),
  });
  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/");
    },
  });
  return (
    <section>
      <PageHeader title="Settings" lede="Account, mailbox connection, and privacy. Tokens never appear here." />
      <article className="surface-card">
        <h2>Account</h2>
        <p>{session.data?.user?.email}</p>
        <p>{session.data?.user?.isDemo ? "Demo account. Not a Google login." : "FLUENT account."}</p>
        <button type="button" className="button secondary" onClick={() => logout.mutate()}>
          Sign out
        </button>
      </article>
      <article className="surface-card">
        <h2>Gmail</h2>
        <p>Status: {gmail.data?.status ?? "unknown"}</p>
        <p>{gmail.data?.email ?? "No mailbox connected."}</p>
        <p>
          The Gmail scope can include send permission at Google. FLUENT send is{" "}
          {gmail.data?.applicationSendEnabled ? "on" : "off"}.
        </p>
        {setup.data?.gmailConnect === "ready" && !gmail.data?.connected ? (
          <a className="button primary" href="/api/gmail/connect/start">
            Connect Gmail
          </a>
        ) : null}
        {setup.data?.gmailConnect === "blocked" ? (
          <p role="status">Connection setup is blocked. Missing: {(setup.data.missing ?? []).join(", ") || "Google OAuth names"}.</p>
        ) : null}
        {gmail.data?.connected ? (
          <button type="button" className="button danger" onClick={() => disconnect.mutate()}>
            Disconnect and revoke
          </button>
        ) : null}
      </article>
      <article className="surface-card">
        <h2>Remote images</h2>
        <label>
          <input
            type="checkbox"
            checked={prefs.data?.loadRemoteImages ?? false}
            onChange={(event) => savePrefs.mutate(event.target.checked)}
          />{" "}
          Allow https images in sanitized HTML. Off by default.
        </label>
      </article>
      <article className="surface-card">
        <h2>AI</h2>
        <p>Provider state: {setup.data?.ai ?? "unknown"}.</p>
      </article>
    </section>
  );
}
