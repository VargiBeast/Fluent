import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/fluent/shell";
import { api } from "@/lib/api";
import { useSetup } from "@/lib/session";

export function OnboardingPage() {
  const setup = useSetup();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const finish = useMutation({
    mutationFn: () =>
      api("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({ onboarded: true }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/overview");
    },
  });
  const scope = setup.data?.gmailScope;
  return (
    <section>
      <PageHeader
        title="Two different permissions"
        lede="Signing into FLUENT only identifies you. Reading and organizing mail needs a separate Gmail connection."
      />
      <div className="card-grid">
        <article className="surface-card">
          <h2>1. FLUENT account</h2>
          <p>Google sign-in asks for openid, email, and profile. It does not read your mailbox.</p>
        </article>
        <article className="surface-card">
          <h2>2. Gmail mailbox</h2>
          <p>
            Connection requests <code>{scope?.scope ?? "https://www.googleapis.com/auth/gmail.modify"}</code>.
            Google describes that scope as read, compose, and send. It does not include permanent deletion.
          </p>
          <p>
            FLUENT will not add a send endpoint, will not write Gmail drafts, and moves deletions to Trash.
            Replies stay as local drafts until you copy them yourself.
          </p>
          {setup.data?.gmailConnect === "ready" ? (
            <a className="button primary" href="/api/gmail/connect/start">
              Connect Gmail
            </a>
          ) : (
            <p role="status">Gmail connection is blocked until Google OAuth and token encryption are configured.</p>
          )}
        </article>
      </div>
      <div className="row-actions">
        <button type="button" className="button primary" onClick={() => finish.mutate()}>
          Continue to overview
        </button>
        <Link href="/settings" className="button secondary">
          Connection settings
        </Link>
      </div>
    </section>
  );
}
