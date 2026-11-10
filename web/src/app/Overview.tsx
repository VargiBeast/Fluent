import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlarmClock, AlertCircle, Clock, FilePen, HelpCircle, Hourglass, Inbox, Menu, MessageSquareReply, Radar, RefreshCw, Sparkles, Star } from "lucide-react";
import type { CopilotReply, PlanPreview } from "@shared/copilot";
import { Dialog } from "@/components/ui/Dialog";
import { PlanCard } from "./copilot/Copilot";
import type { ThreadSummary } from "@shared/mail";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/cn";
import { displayName, listDate, relative } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { SidebarContext } from "./AppLayout";
import { useCopilot } from "./copilot/context";

interface OverviewData {
  generatedAt: string;
  stats: { unread: number; needsReply: number; waiting: number; important: number; total: number };
  needsReply: ThreadSummary[];
  waiting: ThreadSummary[];
  questions?: ThreadSummary[];
  important: ThreadSummary[];
  ai: { headline: string; items: Array<{ thread: ThreadSummary; category: string; reason: string; due: string | null }> } | null;
  aiStatus: "ok" | "not_configured" | "disabled" | "error";
  aiMessage?: string;
  excluded: number;
}

const CATEGORY: Record<string, { label: string; cls: string }> = {
  needs_reply: { label: "Needs reply", cls: "bg-accent-soft text-ai-title" },
  important: { label: "Important", cls: "bg-warning/15 text-warning" },
  waiting: { label: "Waiting", cls: "bg-surface-3 text-fg-2" },
  deadline: { label: "Deadline", cls: "bg-danger/15 text-danger" },
  unresolved: { label: "Unresolved", cls: "bg-surface-3 text-fg-2" },
  fyi: { label: "FYI", cls: "bg-success/15 text-success" },
};

const threadHref = (t: ThreadSummary, folder = "inbox") => `/app/${folder}/${t.accountId}/${t.id}`;

export function OverviewPage() {
  const { session } = useSession();
  const copilot = useCopilot();
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api.get<OverviewData>("/ai/overview"), staleTime: 5 * 60_000, retry: false });
  const d = q.data;
  const firstName = (session?.settings?.profile.displayName || session?.user?.name || "").split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3 lg:px-8">
        <IconButton label="Open navigation" className="lg:hidden" onClick={() => SidebarContext.open()}><Menu className="size-5" /></IconButton>
        <h1 className="flex items-center gap-2 text-[17px] font-semibold text-fg"><Sparkles className="size-4 text-accent-400" /> AI Overview</h1>
        <div className="ml-auto flex items-center gap-2">
          {d && <span className="hidden text-xs text-fg-3 sm:inline">Updated {relative(d.generatedAt)}</span>}
          <IconButton label="Refresh overview" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} />
          </IconButton>
          <Button variant="ai" size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => copilot.open()}>Ask Copilot</Button>
        </div>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 lg:px-8">
          <section>
            <p className="text-[13px] text-fg-3">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-fg">{greet}{firstName ? `, ${firstName}` : ""}</h2>
          </section>

          {q.isLoading ? (
            <OverviewSkeleton />
          ) : q.isError ? (
            <EmptyState icon={<AlertCircle className="size-5" />} title="Couldn't build your overview" description={errorMessage(q.error)} action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
          ) : d ? (
            <>
              <AiBriefing d={d} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat icon={<Inbox className="size-4" />} label="Unread (14 days)" value={d.stats.unread} to="/app/inbox?unread=1" />
                <Stat icon={<MessageSquareReply className="size-4" />} label="Need a reply" value={d.stats.needsReply} to="/app/inbox?filter=unanswered" />
                <Stat icon={<Hourglass className="size-4" />} label="Waiting on others" value={d.stats.waiting} to="/app/sent" />
                <Stat icon={<Star className="size-4" />} label="Important & starred" value={d.stats.important} to="/app/important" />
              </div>
              <FollowUpRadar waiting={d.waiting} questions={d.questions ?? []} aiOn={d.aiStatus !== "not_configured" && d.aiStatus !== "disabled"} />
              <div className="grid gap-4 lg:grid-cols-2">
                <ThreadSection title="Needs your reply" icon={<MessageSquareReply className="size-4" />} threads={d.needsReply} empty="You're all caught up — nothing is waiting on you." />
                <ThreadSection title="Waiting on others" icon={<Clock className="size-4" />} threads={d.waiting} folder="sent" empty="No sent emails are waiting for an answer." note="You sent the last message more than 2 days ago." />
              </div>
              <ThreadSection title="Important & starred" icon={<Star className="size-4" />} threads={d.important} empty="No important or starred conversations in the last two weeks." />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AiBriefing({ d }: { d: OverviewData }) {
  if (d.aiStatus !== "ok" || !d.ai) {
    const msg = {
      not_configured: "AI isn’t configured on this server, so this overview uses Gmail signals only (unread, important, last sender). Add an AI provider key to get a written briefing.",
      disabled: "AI features are turned off in Settings, so this overview uses Gmail signals only.",
      error: `The AI briefing couldn’t be generated right now${d.aiMessage ? ` (${d.aiMessage})` : ""}. Gmail-based triage is shown below.`,
      ok: "",
    }[d.aiStatus];
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-[13.5px] text-fg-2">
        <p className="flex items-center gap-2 font-medium text-fg"><Sparkles className="size-4 text-accent-400" /> AI briefing unavailable</p>
        <p className="mt-1.5">{msg}</p>
        {d.aiStatus === "disabled" && <Link to="/app/settings/ai" className="mt-2 inline-block text-accent-400 hover:underline">Open AI settings</Link>}
      </div>
    );
  }
  return (
    <section className="ai-block rounded-[var(--radius-card)] p-5" aria-labelledby="briefing">
      <h3 id="briefing" className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ai-title"><Sparkles className="size-4" /> Your briefing</h3>
      <p className="mt-2 text-[16px] leading-relaxed text-fg">{d.ai.headline}</p>
      {d.ai.items.length > 0 && (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface/60">
          {d.ai.items.map((it) => {
            const cat = CATEGORY[it.category] ?? CATEGORY.fyi!;
            return (
              <li key={`${it.thread.accountId}:${it.thread.id}`}>
                <Link to={threadHref(it.thread, it.category === "waiting" ? "sent" : "all")} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className={cn("mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", cat.cls)}>{cat.label}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-fg">{it.thread.subject || "(no subject)"}</span>
                    <span className="block text-[12.5px] text-fg-3">{it.reason}</span>
                  </span>
                  {it.due && <span className="flex shrink-0 items-center gap-1 text-[12px] text-warning"><AlarmClock className="size-3.5" />{it.due}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11.5px] text-fg-3">
        Generated from subjects and snippets of recent mail. AI can make mistakes — open the email to check.
        {d.excluded > 0 && ` ${d.excluded} conversation${d.excluded === 1 ? " was" : "s were"} excluded by your privacy settings.`}
      </p>
    </section>
  );
}

function Stat({ icon, label, value, to }: { icon: React.ReactNode; label: string; value: number; to: string }) {
  return (
    <Link to={to} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <span className="flex items-center gap-2 text-[12.5px] text-fg-3">{icon}{label}</span>
      <span className="mt-2 block text-2xl font-semibold text-fg">{value}</span>
    </Link>
  );
}

function ThreadSection({ title, icon, threads, empty, folder = "inbox", note }: { title: string; icon: React.ReactNode; threads: ThreadSummary[]; empty: string; folder?: string; note?: string }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface">
      <h3 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13.5px] font-semibold text-fg"><span className="text-accent-400">{icon}</span>{title}<span className="ml-auto text-xs font-normal text-fg-3">{threads.length}</span></h3>
      {threads.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-fg-3">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {threads.slice(0, 6).map((t) => {
            const who = folder === "sent" && t.lastFromMe ? t.to[0] ?? t.from : t.from;
            return (
              <li key={`${t.accountId}:${t.id}`}>
                <Link to={threadHref(t, folder)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <Avatar name={who?.name ?? ""} email={who?.email ?? ""} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn("truncate text-[13px] text-fg", t.unread && "font-semibold")}>{who ? displayName(who) : "Unknown"}</span>
                      <span className="ml-auto shrink-0 text-[11.5px] text-fg-3">{listDate(t.lastDate)}</span>
                    </span>
                    <span className="block truncate text-[12.5px] text-fg-2">{t.subject || "(no subject)"}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {note && threads.length > 0 && <p className="border-t border-line px-4 py-2 text-[11.5px] text-fg-3">{note}</p>}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading overview">
      <Skeleton className="h-40 w-full rounded-[var(--radius-card)]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-[var(--radius-card)]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64 rounded-[var(--radius-card)]" /><Skeleton className="h-64 rounded-[var(--radius-card)]" /></div>
    </div>
  );
}

/** Follow-up radar: sent mail still waiting on an answer, and questions you haven't answered, with one-click nudges. */
function FollowUpRadar({ waiting, questions, aiOn }: { waiting: ThreadSummary[]; questions: ThreadSummary[]; aiOn: boolean }) {
  const [plan, setPlan] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const nudge = useMutation({
    mutationFn: (p: { t: ThreadSummary; kind: "followup" | "reply" }) => api.post<CopilotReply>("/copilot/nudge", { accountId: p.t.accountId, threadId: p.t.id, kind: p.kind }),
    onMutate: (p) => setBusy(`${p.t.accountId}:${p.t.id}`),
    onSettled: () => setBusy(null),
    onSuccess: (r) => {
      if (r.kind === "plan") setPlan(r.plan);
    },
  });
  if (!waiting.length && !questions.length) return null;
  const row = (t: ThreadSummary, kind: "followup" | "reply") => {
    const who = kind === "followup" ? t.to[0] ?? t.from : t.from;
    const days = Math.max(1, Math.round((Date.now() - Date.parse(t.lastDate)) / 86400_000));
    const key = `${t.accountId}:${t.id}`;
    return (
      <li key={key} className="flex items-center gap-3 px-4 py-2.5">
        <Avatar name={who?.name ?? ""} email={who?.email ?? ""} size={28} />
        <Link to={threadHref(t, kind === "followup" ? "sent" : "inbox")} className="min-w-0 flex-1 hover:underline">
          <span className="block truncate text-[13px] text-fg">{who ? displayName(who) : "Unknown"} <span className="text-fg-3">· {days}d</span></span>
          <span className="block truncate text-[12.5px] text-fg-2">{t.subject || "(no subject)"}</span>
        </Link>
        {aiOn && (
          <Button size="sm" variant="ai" loading={busy === key} disabled={busy !== null} icon={<FilePen className="size-3.5" />} onClick={() => nudge.mutate({ t, kind })} aria-label={`${kind === "followup" ? "Draft nudge" : "Draft reply"}: ${t.subject}`}>
            {kind === "followup" ? "Nudge" : "Reply"}
          </Button>
        )}
      </li>
    );
  };
  return (
    <section aria-labelledby="radar" className="rounded-[var(--radius-card)] border border-[var(--ai-border)] bg-surface">
      <h3 id="radar" className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13.5px] font-semibold text-fg">
        <Radar className="size-4 text-accent-400" /> Follow-up radar
        <span className="ml-auto text-xs font-normal text-fg-3">{waiting.length + questions.length}</span>
      </h3>
      <div className="grid divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div>
          <p className="flex items-center gap-1.5 px-4 pt-3 text-[11.5px] font-medium uppercase tracking-wide text-fg-3"><Hourglass className="size-3" /> Waiting on a reply</p>
          {waiting.length ? <ul className="divide-y divide-line">{waiting.slice(0, 5).map((t) => row(t, "followup"))}</ul> : <p className="px-4 py-4 text-[12.5px] text-fg-3">Nobody owes you an answer right now.</p>}
        </div>
        <div>
          <p className="flex items-center gap-1.5 px-4 pt-3 text-[11.5px] font-medium uppercase tracking-wide text-fg-3"><HelpCircle className="size-3" /> Questions you haven’t answered</p>
          {questions.length ? <ul className="divide-y divide-line">{questions.slice(0, 5).map((t) => row(t, "reply"))}</ul> : <p className="px-4 py-4 text-[12.5px] text-fg-3">No open questions. Nice.</p>}
        </div>
      </div>
      {nudge.isError && <p role="alert" className="border-t border-line px-4 py-2 text-[12.5px] text-danger">{errorMessage(nudge.error)}</p>}
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-fg-3">Nudges are drafted by AI and shown to you first. Nothing is saved or sent until you confirm.</p>
      <Dialog open={plan !== null} onOpenChange={(o) => !o && setPlan(null)} title="Review the draft" description="Confirm to save it as a Gmail draft." wide>
        {plan && <PlanCard key={plan.planId ?? "x"} plan={plan} />}
      </Dialog>
    </section>
  );
}
