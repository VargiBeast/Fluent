import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button, ErrorState, LoadingState, PageHeader } from "@/components/fluent/states";
import { useToast } from "@/components/fluent/toast";
import { api, ApiClientError } from "@/lib/api";
import { useSession, useSetup } from "@/lib/session";

export function SettingsPage() {
  const session = useSession();
  const setup = useSetup();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const toast = useToast();
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["preferences"] });
      toast.notify({ title: "Privacy setting saved" });
    },
  });
  const sync = useMutation({
    mutationFn: () => api<{ source: string; imported: number }>("/api/gmail/sync", { method: "POST", body: "{}" }),
    onSuccess: (result) => toast.notify({ title: "Sync finished", body: `${result.source}: ${result.imported} conversation(s) on this page.` }),
  });
  const disconnect = useMutation({
    mutationFn: () => api("/api/gmail/disconnect", { method: "POST", body: "{}" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
      toast.notify({ title: "Mailbox disconnected", body: "Local tokens were cleared." });
    },
  });
  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login");
    },
  });
  return (
    <section data-screen="settings">
      <PageHeader title="Settings" lede="Account, connection, privacy, and the AI setup state. Tokens are never shown." />
      <div className="card-grid">
        <article className="surface">
          <h2>Account</h2>
          {session.isLoading ? <LoadingState label="Loading account" /> : null}
          <p>{session.data?.user?.email}</p>
          <p>{session.data?.user?.isDemo ? "Demo account. Not a Google login." : "FLUENT account."}</p>
          <Button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
            Sign out
          </Button>
          {logout.isError ? <ErrorState message="Sign-out failed." /> : null}
        </article>
        <article className="surface">
          <h2>Connected mailbox</h2>
          {gmail.isLoading ? <LoadingState label="Checking Gmail" /> : null}
          {gmail.isError ? <ErrorState message="Could not read connection status." /> : null}
          <p>Status: {gmail.data?.status ?? "unknown"}</p>
          <p>{gmail.data?.email ?? "No mailbox connected."}</p>
          <p>
            Google’s modify scope can include send. In this app, send is {gmail.data?.applicationSendEnabled ? "on" : "off"}.
          </p>
          {setup.data?.gmailConnect === "ready" && !gmail.data?.connected ? (
            <a className="button primary" href="/api/gmail/connect/start">
              Connect Gmail
            </a>
          ) : null}
          {setup.data?.gmailConnect === "blocked" ? (
            <p role="status">Connection is blocked. Missing: {(setup.data.missing ?? []).filter((name) => name !== "AI_API_KEY").join(", ") || "Google OAuth names"}.</p>
          ) : null}
          {gmail.data?.connected ? (
            <Button type="button" variant="danger" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              Disconnect and revoke
            </Button>
          ) : null}
          {disconnect.isError ? <ErrorState message="Disconnect failed." /> : null}
        </article>
        <article className="surface">
          <h2>Synchronization</h2>
          <p className="hint">Refresh loads one page. It is not a full mailbox export.</p>
          <Button type="button" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? "Syncing" : "Sync now"}
          </Button>
          {sync.isError ? <ErrorState message={sync.error instanceof ApiClientError ? sync.error.message : "Sync failed"} /> : null}
        </article>
        <article className="surface">
          <h2>Privacy</h2>
          <label>
            <input
              type="checkbox"
              checked={prefs.data?.loadRemoteImages ?? false}
              onChange={(event) => savePrefs.mutate(event.target.checked)}
              disabled={savePrefs.isPending}
            />{" "}
            Allow https images inside the sandboxed message frame.
          </label>
          {savePrefs.isError ? <ErrorState message="Could not save the privacy setting." /> : null}
        </article>
        <article className="surface">
          <h2>AI</h2>
          <p>Provider state: {setup.data?.ai ?? "unknown"}.</p>
          <p className="hint">Mock means extractive text, not a live model. Blocked means no analysis is invented.</p>
        </article>
        <article className="surface">
          <h2>Appearance</h2>
          <p>Dark is the only theme in this version. Motion follows your reduced-motion setting.</p>
        </article>
      </div>
    </section>
  );
}
