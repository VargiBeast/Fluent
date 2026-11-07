import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button, ErrorState, LoadingState } from "@/components/fluent/states";
import { api, ApiClientError } from "@/lib/api";
import { useSession, useSetup } from "@/lib/session";

export function LoginPage() {
  const setup = useSetup();
  const session = useSession();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const demo = useMutation({
    mutationFn: () => api("/api/auth/demo", { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/onboarding");
    },
  });
  return (
    <div className="login-screen" data-screen="login">
      <div className="login-layout">
      <section className="login-story">
        <div className="login-story-copy">
          <p className="badge">FLUENT</p>
          <h1>Email, without the effort.</h1>
          <p>Sign in first. Connecting a mailbox is a later, separate consent.</p>
          <ul>
            <li>Read the conversation before you answer.</li>
            <li>Drafts stay in FLUENT. Nothing is sent.</li>
            <li>Archive and Trash each ask again.</li>
          </ul>
          <Link href="/">Product introduction</Link>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>Continue</h2>
          {session.data?.authenticated ? (
            <p role="status">
              You already have a session. <Link href="/overview">Open the workspace</Link>.
            </p>
          ) : null}
          {setup.isLoading ? <LoadingState label="Checking sign-in setup" /> : null}
          {setup.isError ? <ErrorState message="The API could not be reached." /> : null}
          {setup.data?.googleLogin === "ready" ? (
            <a className="button primary" href="/api/auth/google/start">
              Continue with Google
            </a>
          ) : (
            <div className="surface" role="status">
              <h3>Google sign-in is not configured</h3>
              <p>This is a setup blocker, not a connected account.</p>
              <ul>
                {(setup.data?.missing ?? ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"])
                  .filter((name) => name !== "AI_API_KEY")
                  .map((name) => (
                    <li key={name}>
                      <code>{name}</code>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {setup.data?.demoMode ? (
            <Button type="button" variant="secondary" onClick={() => demo.mutate()} disabled={demo.isPending}>
              {demo.isPending ? "Opening demo" : "Enter labeled demo"}
            </Button>
          ) : (
            <p className="hint">Demo mode is off. It is never presented as Google sign-in.</p>
          )}
          {demo.isError ? <ErrorState message={demo.error instanceof ApiClientError ? demo.error.message : "Demo sign-in failed"} /> : null}
        </div>
      </section>
      </div>
    </div>
  );
}
