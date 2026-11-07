import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button, PageHeader } from "@/components/fluent/states";
import { api } from "@/lib/api";
import { useSetup } from "@/lib/session";

const STEPS = ["Account", "Permissions", "Workspace"];

export function OnboardingPage() {
  const setup = useSetup();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const finish = useMutation({
    mutationFn: () => api("/api/preferences", { method: "PUT", body: JSON.stringify({ onboarded: true }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/overview");
    },
  });
  const scope = setup.data?.gmailScope;
  return (
    <section data-screen="onboarding">
      <PageHeader
        eyebrow="Step 2 of 3"
        title="Two different permissions"
        lede="Signing in identifies you. Reading mail needs a separate Gmail connection. Neither step sends email."
      />
      <ol className="chip-row" aria-label="Onboarding progress">
        {STEPS.map((step, index) => (
          <li key={step} className="chip" aria-current={index === 1 ? "step" : undefined}>
            {step}
          </li>
        ))}
      </ol>
      <div className="card-grid">
        <article className="surface">
          <h2>FLUENT account</h2>
          <p>Google sign-in, when configured, asks for openid, email, and profile. It does not read the mailbox.</p>
        </article>
        <article className="surface">
          <h2>Gmail mailbox</h2>
          <p>
            Connection requests <code>{scope?.scope ?? "https://www.googleapis.com/auth/gmail.modify"}</code>. Google
            describes that scope as read, compose, and send. It does not include permanent deletion.
          </p>
          <p>FLUENT still has no send button and does not write Gmail drafts. Trash is a move, not a delete.</p>
          {setup.data?.gmailConnect === "ready" ? (
            <a className="button primary" href="/api/gmail/connect/start">
              Connect Gmail
            </a>
          ) : (
            <p role="status">Gmail connection stays blocked until Google OAuth and token encryption are configured.</p>
          )}
        </article>
        <article className="surface">
          <h2>Privacy</h2>
          <p>Tokens stay on the server, encrypted. The demo mailbox, if you used it, is synthetic and shared only inside demo mode.</p>
        </article>
      </div>
      <div className="row-actions">
        <Button type="button" variant="primary" onClick={() => finish.mutate()} disabled={finish.isPending}>
          {finish.isPending ? "Saving" : "Continue to overview"}
        </Button>
        <Link href="/settings" className="button secondary">
          Connection settings
        </Link>
      </div>
      {finish.isError ? <p role="alert">Could not save onboarding progress.</p> : null}
    </section>
  );
}
