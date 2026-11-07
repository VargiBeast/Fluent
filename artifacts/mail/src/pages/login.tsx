import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, ApiClientError } from "@/lib/api";
import { useSetup } from "@/lib/session";
import { ErrorState, LoadingState } from "@/components/fluent/shell";

export function LoginPage() {
  const setup = useSetup();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const demo = useMutation({
    mutationFn: () =>
      api("/api/auth/demo", { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/onboarding");
    },
  });
  return (
    <div className="login-screen">
      <div className="login-card">
        <p className="eyebrow">FLUENT</p>
        <h1>Email, without the effort.</h1>
        <p className="lede">
          Sign in to FLUENT first. Connecting a Gmail mailbox is a separate step, with its own consent screen.
        </p>
        {setup.isLoading ? <LoadingState label="Checking sign-in setup" /> : null}
        {setup.isError ? <ErrorState message="The API could not be reached." /> : null}
        {setup.data?.googleLogin === "ready" ? (
          <a className="button primary" href="/api/auth/google/start">
            Continue with Google
          </a>
        ) : (
          <div className="blocked-panel" role="status">
            <h2>Google sign-in is not configured</h2>
            <p>This is a setup blocker, not a connected account. Add these environment names and restart the API:</p>
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
          <button type="button" className="button secondary" onClick={() => demo.mutate()} disabled={demo.isPending}>
            Enter labeled demo
          </button>
        ) : (
          <p className="hint">Demo mode is off. A demo session is never presented as Google sign-in.</p>
        )}
        {demo.isError ? (
          <ErrorState message={demo.error instanceof ApiClientError ? demo.error.message : "Demo sign-in failed"} />
        ) : null}
      </div>
    </div>
  );
}
