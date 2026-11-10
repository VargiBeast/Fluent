import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, ShieldOff, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ThreadDetail } from "@shared/mail";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/Button";
import { displayName } from "@/lib/format";

export interface Insights {
  summary: string;
  keyPoints: string[];
  actionItems: Array<{ task: string; owner: string | null; due: string | null }>;
  deadlines: Array<{ what: string; when: string }>;
  needsReply: boolean;
  quickReplies: string[];
}

export function useInsights(thread: ThreadDetail | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["insights", thread?.accountId, thread?.id, thread?.messages.length],
    enabled: Boolean(thread) && enabled,
    queryFn: () => api.post<Insights>("/ai/insights", { accountId: thread!.accountId, threadId: thread!.id }),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function AiSummary({ thread, insights, autoEnabled, onRequest }: {
  thread: ThreadDetail;
  insights: ReturnType<typeof useInsights>;
  autoEnabled: boolean;
  onRequest: () => void;
}) {
  const { config, session } = useSession();
  const [expanded, setExpanded] = useState(false);
  const lastOther = [...thread.messages].reverse().find((m) => !m.isFromMe) ?? thread.messages[thread.messages.length - 1];
  const title = `Summary of ${lastOther ? displayName(lastOther.from) : "this"}’s email`;

  if (!config?.ai) {
    return (
      <Block title="AI summary">
        <p className="text-fg-3">AI isn’t configured on this server yet. Add an AI provider key to enable summaries, drafting and smart search.</p>
      </Block>
    );
  }
  if (session?.settings?.ai.enabled === false) {
    return (
      <Block title="AI summary">
        <p className="text-fg-3">AI features are turned off in your settings.</p>
      </Block>
    );
  }
  if (!autoEnabled && !insights.data && !insights.isFetching && !insights.isError) {
    return (
      <Block title={title}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-fg-3">Get a summary, action items and deadlines for this conversation.</p>
          <Button size="sm" variant="ai" icon={<Sparkles className="size-3.5" />} onClick={onRequest}>Summarize</Button>
        </div>
      </Block>
    );
  }
  if (insights.isLoading || insights.isFetching && !insights.data) {
    return (
      <Block title={title} busy>
        <div className="space-y-2" aria-label="Generating summary">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </Block>
    );
  }
  if (insights.isError) {
    const e = insights.error;
    if (e instanceof ApiError && e.code === "ai_excluded") {
      return (
        <Block title="AI summary">
          <p className="flex items-center gap-2 text-fg-3"><ShieldOff className="size-4" aria-hidden />This conversation is excluded from AI by your privacy settings.</p>
        </Block>
      );
    }
    return (
      <Block title={title}>
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-fg-3"><AlertTriangle className="size-4 text-warning" aria-hidden />{errorMessage(e)}</p>
          <Button size="sm" variant="ghost" onClick={() => void insights.refetch()}>Retry</Button>
        </div>
      </Block>
    );
  }
  const d = insights.data;
  if (!d) return null;
  const hasMore = d.keyPoints.length > 0 || d.actionItems.length > 0 || d.deadlines.length > 0;
  return (
    <Block title={title}>
      <p className="text-fg-2">{d.summary}</p>
      {hasMore && expanded && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {d.actionItems.length > 0 && (
            <div>
              <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-ai-title">Action items</p>
              <ul className="space-y-1">
                {d.actionItems.map((a, i) => (
                  <li key={i} className="flex gap-2 text-fg-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-accent-400" aria-hidden /><span>{a.task}{a.due ? <span className="text-fg-3"> · {a.due}</span> : null}</span></li>
                ))}
              </ul>
            </div>
          )}
          {d.deadlines.length > 0 && (
            <div>
              <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-ai-title">Deadlines</p>
              <ul className="space-y-1">
                {d.deadlines.map((a, i) => (
                  <li key={i} className="flex gap-2 text-fg-2"><CalendarClock className="mt-0.5 size-3.5 shrink-0 text-accent-400" aria-hidden /><span>{a.what} — <span className="text-fg">{a.when}</span></span></li>
                ))}
              </ul>
            </div>
          )}
          {d.keyPoints.length > 0 && (
            <div className="sm:col-span-2">
              <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-ai-title">Key points</p>
              <ul className="list-disc space-y-0.5 pl-5 text-fg-2">{d.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {hasMore && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-[12px] font-medium text-ai-title hover:underline" aria-expanded={expanded}>
          {expanded ? "Show less" : `Show action items & deadlines (${d.actionItems.length + d.deadlines.length})`}
        </button>
      )}
      <p className="mt-2 text-[11px] text-fg-3">AI-generated from this conversation. Check important details.</p>
    </Block>
  );
}

function Block({ title, children, busy }: { title: string; children: React.ReactNode; busy?: boolean }) {
  return (
    <section aria-label="AI summary" aria-busy={busy} className="ai-block rounded-2xl px-4 py-3.5 text-[13.5px] leading-relaxed animate-in">
      <h2 className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-ai-title">
        <Sparkles className="size-3.5" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}
