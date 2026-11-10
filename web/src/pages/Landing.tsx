import { Link, Navigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, EyeOff, Inbox, Keyboard, Lock, MessageSquareText, PenLine, Search, ShieldCheck, Sparkles, Tags } from "lucide-react";
import { useSession } from "@/lib/session";
import { Logo } from "@/components/ui/misc";
import { Splash } from "@/components/Splash";
import { PublicFooter } from "./Legal";

const ERRORS: Record<string, string> = {
  access_denied: "You cancelled Google sign-in. FLUENT needs your permission to show your mail.",
  not_configured: "Google sign-in isn't configured on this server yet.",
  state_invalid: "Your sign-in link expired or was tampered with. Please try again.",
  state_missing: "Your sign-in session expired (cookies may be blocked). Please try again.",
  email_unverified: "Your Google account's email address isn't verified.",
  session_required: "Please sign in first.",
  session_mismatch: "You were signed out while connecting an account. Please sign in again.",
};

const FEATURES = [
  { icon: Inbox, title: "One calm inbox", text: "All your Gmail accounts in one unified, fast inbox with categories, labels, filters and keyboard shortcuts." },
  { icon: Sparkles, title: "Summaries that get to the point", text: "Open a thread and see a short summary, key points, action items and deadlines." },
  { icon: PenLine, title: "Replies in your voice", text: "Draft, shorten or change the tone of an email. You always review AI text before it's sent." },
  { icon: Search, title: "Search the way you think", text: "“Find the invoice I got last month” becomes a precise Gmail search you can see and edit." },
  { icon: MessageSquareText, title: "Ask your inbox", text: "Ask questions about your mail and get answers that link to the exact emails they came from." },
  { icon: ShieldCheck, title: "Private by design", text: "No email bodies stored, remote images blocked, AI exclusions for senders and labels, and a full AI access log." },
];

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LandingPage() {
  const { session, config, loading } = useSession();
  const [params] = useSearchParams();
  const error = params.get("error");
  const deleted = params.get("deleted") === "1";
  const next = params.get("next");
  if (loading) return <Splash />;
  if (session?.user && !error) return <Navigate to={next && next.startsWith("/app") ? next : "/app"} replace />;
  const googleReady = config?.google !== false;
  const signInHref = `/api/auth/google/start${next && next.startsWith("/app") ? `?next=${encodeURIComponent(next)}` : ""}`;

  const SignIn = ({ className = "" }: { className?: string }) =>
    googleReady ? (
      <a href={signInHref} className={`inline-flex h-12 items-center justify-center gap-3 rounded-xl bg-white px-6 text-[15px] font-medium text-[#1f1f1f] shadow-[0_10px_40px_-12px_rgba(139,92,246,0.7)] transition hover:bg-[#f2f2f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400 ${className}`}>
        <GoogleIcon /> Sign in with Google
      </a>
    ) : (
      <span aria-disabled="true" className={`inline-flex h-12 cursor-not-allowed items-center justify-center gap-3 rounded-xl bg-white/60 px-6 text-[15px] font-medium text-[#1f1f1f]/70 ${className}`}>
        <GoogleIcon /> Sign in with Google
      </span>
    );

  return (
    <div className="dark min-h-full overflow-x-hidden bg-[#08080b] text-fg">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(139,92,246,0.28),transparent_70%)]" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-5 text-[13.5px] text-fg-2">
          <a href="#features" className="hidden hover:text-fg sm:inline">Features</a>
          <a href="#privacy" className="hidden hover:text-fg sm:inline">Privacy</a>
          {googleReady ? <a href={signInHref} className="rounded-lg border border-line-strong px-3.5 py-1.5 text-fg hover:bg-surface-2">Sign in</a> : null}
        </nav>
      </header>

      <main className="relative">
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-12 text-center sm:pt-20">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--ai-border)] bg-accent-soft px-3 py-1 text-[12.5px] text-ai-title"><Sparkles className="size-3.5" /> AI email client for Gmail</p>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Your inbox, <span className="bg-gradient-to-r from-accent-300 to-accent-600 bg-clip-text text-transparent">understood.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-[16px] leading-relaxed text-fg-2 sm:text-[17px]">
            FLUENT reads your Gmail with you — summarizing threads, drafting replies and answering questions — while keeping you in control of every send.
          </p>
          {(error || deleted || !googleReady) && (
            <div role={error ? "alert" : "status"} className={`mx-auto mt-6 flex max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-left text-[13.5px] ${error || !googleReady ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10"}`}>
              {error || !googleReady ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
              <span className="text-fg-2">
                {deleted ? "Your FLUENT data was deleted and Google access revoked." : error ? (ERRORS[error] ?? "Sign-in didn't complete. Please try again.") : "Google sign-in isn't configured on this server. The owner needs to add Google OAuth credentials (see docs/SETUP.md)."}
              </span>
            </div>
          )}
          <div className="mt-8 flex flex-col items-center gap-3">
            <SignIn />
            <p className="text-[12.5px] text-fg-3">Connects securely through Google · You approve every permission</p>
          </div>
          <ProductPreview />
        </section>

        <section id="features" className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Everything email should have been</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-[15px] text-fg-2">Built around the way you actually read and answer mail.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface/70 p-5 transition-colors hover:border-[var(--ai-border)]">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-400"><f.icon className="size-5" /></span>
                <h3 className="mt-4 text-[15.5px] font-semibold text-fg">{f.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">{f.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Keyboard, text: "Keyboard-first: j/k, e to archive, r to reply, / to search." },
              { icon: Tags, text: "Labels, folders and Gmail filters — every action syncs to Gmail." },
              { icon: EyeOff, text: "Tracking pixels and remote images blocked until you allow them." },
            ].map((x) => (
              <div key={x.text} className="flex items-start gap-3 rounded-xl border border-line bg-surface/50 p-4 text-[13px] text-fg-2"><x.icon className="mt-0.5 size-4 shrink-0 text-accent-400" />{x.text}</div>
            ))}
          </div>
        </section>

        <section id="privacy" className="mx-auto max-w-6xl px-5 py-16">
          <div className="ai-block grid gap-8 rounded-3xl p-8 sm:p-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Lock className="size-5 text-accent-400" /> Your mail stays yours</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-fg-2">FLUENT uses Google's official Gmail API with your permission. It fetches mail live and does not keep copies of your messages. AI only sees the emails needed for the request you make, and the AI can't send, delete or forward anything by itself.</p>
              <div className="mt-5 flex flex-wrap gap-4 text-[13.5px]">
                <Link to="/privacy" className="text-accent-400 hover:underline">Read the privacy policy</Link>
                <Link to="/terms" className="text-accent-400 hover:underline">Terms of service</Link>
              </div>
            </div>
            <ul className="space-y-3 text-[14px] text-fg-2">
              {[
                "Email bodies and attachments are never stored in FLUENT's database",
                "OAuth tokens encrypted at rest with AES-256-GCM",
                "Exclude senders and labels from AI — enforced on the server",
                "See every AI request in your privacy dashboard, and clear it any time",
                "Export or delete your FLUENT data in one click",
                "Gmail data is never used for ads or to train AI models",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent-400" />{t}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-20 pt-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ready for a calmer inbox?</h2>
          <div className="mt-6 flex justify-center"><SignIn /></div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

/** Illustrative, non-interactive sketch of the three-pane layout (no real or claimed data). */
function ProductPreview() {
  const rows = [
    { w: "w-24", s: "w-40", unread: true, active: true },
    { w: "w-20", s: "w-32", unread: true },
    { w: "w-28", s: "w-36" },
    { w: "w-16", s: "w-28" },
    { w: "w-24", s: "w-40" },
  ];
  return (
    <figure className="relative mx-auto mt-14 max-w-5xl" aria-label="Illustration of the FLUENT interface">
      <div aria-hidden className="absolute -inset-6 rounded-[32px] bg-[radial-gradient(50%_50%_at_50%_50%,rgba(139,92,246,0.25),transparent_70%)] blur-2xl" />
      <div aria-hidden className="relative grid h-[340px] grid-cols-[150px_1fr] overflow-hidden rounded-2xl border border-line-strong bg-[#0e0e12] text-left shadow-2xl sm:h-[420px] sm:grid-cols-[180px_280px_1fr]">
        <div className="space-y-2 border-r border-line p-4">
          <div className="mb-4 h-8 rounded-lg bg-accent/90" />
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`h-6 rounded-md ${i === 0 ? "bg-accent-soft" : "bg-surface-2/60"}`} />)}
        </div>
        <div className="space-y-1 border-r border-line p-3">
          <div className="mb-3 h-8 rounded-lg bg-surface-2" />
          {rows.map((r, i) => (
            <div key={i} className={`flex gap-2.5 rounded-lg p-2.5 ${r.active ? "bg-accent-soft ring-1 ring-[var(--ai-border)]" : ""}`}>
              <div className="size-7 shrink-0 rounded-full bg-surface-3" />
              <div className="space-y-1.5">
                <div className={`h-2.5 rounded ${r.w} ${r.unread ? "bg-fg/70" : "bg-fg-3/50"}`} />
                <div className={`h-2 rounded ${r.s} bg-fg-3/30`} />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden space-y-4 p-6 sm:block">
          <div className="h-4 w-2/3 rounded bg-fg/60" />
          <div className="ai-block space-y-2 rounded-xl p-4">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ai-title"><Sparkles className="size-3.5" /> AI summary</div>
            <div className="h-2.5 w-full rounded bg-accent-300/30" />
            <div className="h-2.5 w-5/6 rounded bg-accent-300/30" />
            <div className="h-2.5 w-2/3 rounded bg-accent-300/30" />
          </div>
          {[0, 1, 2, 3].map((i) => <div key={i} className={`h-2.5 rounded bg-fg-3/25 ${i === 3 ? "w-1/2" : "w-full"}`} />)}
          <div className="flex gap-2 pt-2">{["w-28", "w-24", "w-32"].map((w) => <div key={w} className={`h-8 ${w} rounded-full border border-line bg-surface-2`} />)}</div>
        </div>
      </div>
    </figure>
  );
}
