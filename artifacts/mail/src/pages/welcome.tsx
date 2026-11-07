import { Link } from "wouter";
import { useSession } from "@/lib/session";

export function WelcomePage() {
  const session = useSession();
  const signedIn = session.data?.authenticated;
  return (
    <div className="marketing" data-screen="welcome">
      <header className="marketing-hero">
        <p className="badge">FLUENT</p>
        <h1>Email, without the effort.</h1>
        <p className="lede">
          A quieter place to read, understand, and answer mail. You stay in control of every archive and every deletion.
          This introduction is separate from the signed-in workspace.
        </p>
        <div className="row-actions">
          <Link href="/login" className="button primary">
            {signedIn ? "Account" : "Sign in"}
          </Link>
          {signedIn ? (
            <Link href="/overview" className="button secondary">
              Open workspace
            </Link>
          ) : null}
        </div>
      </header>
      <section className="marketing-grid">
        <article className="marketing-panel">
          <h2>The pile</h2>
          <p>Traditional inboxes ask you to reconstruct the story yourself. FLUENT keeps the conversation, the ask, and the date you can actually point to.</p>
        </article>
        <article className="marketing-panel">
          <h2>The copilot</h2>
          <p>Summaries and reply drafts are suggestions. They are labeled when they come from the extractive demo adapter. They cannot send, archive, or delete.</p>
        </article>
        <article className="marketing-panel">
          <h2>Your mailbox</h2>
          <p>Signing into FLUENT is not the same as connecting Gmail. A live connection needs your own Google setup. Until then, a demo mailbox is clearly marked synthetic.</p>
        </article>
        <article className="marketing-panel">
          <h2>Control</h2>
          <p>Archive and Trash each ask again, on the server, for that one conversation. Nothing here is a bulk action, and Trash is not a permanent delete.</p>
        </article>
      </section>
    </div>
  );
}
