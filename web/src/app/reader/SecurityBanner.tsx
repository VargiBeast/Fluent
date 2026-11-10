import { useMutation } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { ThreadDetail } from "@shared/mail";
import type { SecurityReview } from "@shared/security";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const VERDICT: Record<SecurityReview["verdict"], string> = {
  likely_safe: "Copilot: probably safe",
  suspicious: "Copilot: looks suspicious",
  likely_phishing: "Copilot: likely phishing",
};

/**
 * Warns about phishing and fake invoices in the latest received message. The reasons come from the server's
 * own checks (no AI); "Ask Copilot" adds a plain-language second opinion when AI is on.
 */
export function SecurityBanner({ thread }: { thread: ThreadDetail }) {
  const { config, session } = useSession();
  const aiOn = Boolean(config?.ai) && session?.settings?.ai.enabled !== false;
  const m = [...thread.messages].reverse().find((x) => x.security && x.security.level !== "safe");
  const [open, setOpen] = useState(false);
  const review = useMutation({
    mutationFn: () => api.post<SecurityReview>("/ai/security", { accountId: thread.accountId, threadId: thread.id, messageId: m!.id }),
  });
  if (!m?.security) return null;
  const danger = m.security.level === "danger";
  const shown = open ? m.security.signals : m.security.signals.slice(0, 2);
  return (
    <section
      role={danger ? "alert" : "status"}
      aria-label="Security warning"
      className={cn("rounded-2xl border px-4 py-3 text-[13.5px] leading-relaxed animate-in", danger ? "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_9%,transparent)]" : "border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]")}
    >
      <h2 className={cn("flex items-center gap-2 text-[13.5px] font-semibold", danger ? "text-danger" : "text-warning")}>
        {danger ? <ShieldAlert className="size-4" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
        {danger ? "Be careful: this looks like phishing" : "Check before you act on this email"}
      </h2>
      <ul className="mt-1.5 max-w-[70ch] list-disc space-y-0.5 pl-5 text-fg-2">
        {shown.map((s) => <li key={s.code}>{s.text}</li>)}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {m.security.signals.length > 2 && (
          <button type="button" className="text-[12px] font-medium text-fg-2 underline-offset-2 hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Show fewer" : `Show all ${m.security.signals.length} reasons`}
          </button>
        )}
        {aiOn && !review.data && (
          <Button size="sm" variant="ai" icon={<Sparkles className="size-3.5" />} loading={review.isPending} onClick={() => review.mutate()}>
            Ask Copilot to check
          </Button>
        )}
        {review.isError && <span className="text-[12px] text-danger">{errorMessage(review.error)}</span>}
      </div>
      {review.data && (
        <div className="mt-2.5 rounded-xl bg-surface/60 px-3 py-2.5" data-testid="security-review">
          <p className="flex items-center gap-1.5 font-semibold text-fg">
            {review.data.verdict === "likely_safe" ? <ShieldCheck className="size-4 text-success" aria-hidden /> : <ShieldAlert className="size-4 text-danger" aria-hidden />}
            {VERDICT[review.data.verdict]}
          </p>
          <ul className="mt-1 max-w-[70ch] list-disc space-y-0.5 pl-5 text-fg-2">{review.data.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="mt-1.5 max-w-[70ch] text-fg">{review.data.advice}</p>
          <p className="mt-1 text-[11px] text-fg-3">AI-generated. FLUENT never sends anything or clicks links for you.</p>
        </div>
      )}
    </section>
  );
}
