import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, BarChart3, Clock, Inbox, Menu, RefreshCw, Send, Timer } from "lucide-react";
import type { InboxStats, StatsRange } from "@shared/stats";
import { STATS_RANGES } from "@shared/stats";
import { api, errorMessage, qs } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relative, displayName } from "@/lib/format";
import { bucketLabel, formatDuration, hourLabel, niceMax } from "@/lib/stats";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useSession } from "@/lib/session";
import { SidebarContext } from "./AppLayout";

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

export function StatsPage() {
  const [params] = useSearchParams();
  const account = params.get("account") ?? undefined;
  const [days, setDays] = useState<StatsRange>(30);
  const { session } = useSession();
  const q = useQuery({
    queryKey: ["stats", days, account ?? "all"],
    queryFn: ({ signal }) => api.get<InboxStats>(`/stats${qs({ days, account, tz: tz() })}`, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const d = q.data;
  const accountEmail = account ? session?.accounts?.find((a) => a.id === account)?.email : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 lg:px-8">
        <IconButton label="Open navigation" className="lg:hidden" onClick={() => SidebarContext.open()}><Menu className="size-5" /></IconButton>
        <h1 className="flex items-center gap-2 text-[17px] font-semibold text-fg"><BarChart3 className="size-4 text-accent-400" /> Inbox stats</h1>
        {accountEmail && <span className="truncate text-[12.5px] text-fg-3">{accountEmail}</span>}
        <div className="ml-auto flex items-center gap-2">
          <div role="radiogroup" aria-label="Time range" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
            {STATS_RANGES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={days === r} onClick={() => setDays(r)} className={cn("h-7 rounded-md px-2.5 text-[12.5px]", days === r ? "bg-surface-3 font-medium text-fg shadow-sm" : "text-fg-3 hover:text-fg")}>
                {r} days
              </button>
            ))}
          </div>
          <IconButton label="Refresh stats" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} />
          </IconButton>
        </div>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 lg:px-8">
          {q.isLoading ? (
            <StatsSkeleton />
          ) : q.isError ? (
            <EmptyState icon={<AlertCircle className="size-5" />} title="Couldn't load your stats" description={errorMessage(q.error)} action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
          ) : d ? (
            <>
              {d.errors.length > 0 && (
                <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-fg-2">
                  <AlertTriangle className="size-4 text-warning" aria-hidden /> Some accounts couldn't be read: {d.errors.map((e) => e.message).join(" ")}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi icon={<Inbox className="size-4" />} label="Received" value={d.totals.received.toLocaleString()} />
                <Kpi icon={<Send className="size-4" />} label="Sent" value={d.totals.sent.toLocaleString()} />
                <Kpi icon={<Timer className="size-4" />} label="Average response" value={formatDuration(d.response.averageMinutes)} hint={d.response.replies ? `${d.response.replies} replies` : "No replies yet"} />
                <Kpi icon={<Clock className="size-4" />} label="Median response" value={formatDuration(d.response.medianMinutes)} hint="Half your replies are faster" />
              </div>
              <VolumeChart d={d} />
              <div className="grid gap-5 lg:grid-cols-2">
                <TopSenders d={d} />
                <ResponseChart d={d} />
              </div>
              <HoursChart d={d} />
              <p className="text-[11.5px] text-fg-3">
                Computed live from Gmail (sender, date and labels only; nothing is stored) for the last {d.days} days in {d.timeZone}, from {d.sample.conversations.toLocaleString()} conversations
                {d.sample.truncated ? ` (the most recent ${d.sample.limit}; older activity isn't counted)` : ""}. Updated {relative(d.generatedAt)}.
                Response time runs from the first message you hadn't answered to your reply in the same conversation.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <p className="flex items-center gap-2 text-[12.5px] text-fg-3"><span className="text-accent-400">{icon}</span>{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-fg-3">{hint}</p>}
    </div>
  );
}

function Card({ title, children, legend, id }: { title: string; children: React.ReactNode; legend?: React.ReactNode; id: string }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby={id}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-[14px] font-semibold text-fg">{title}</h2>
        {legend}
      </div>
      {children}
    </section>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[12px] text-fg-3">
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent-500" aria-hidden />Received</span>
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-sky-400" aria-hidden />Sent</span>
    </div>
  );
}

/** Grouped bars (received/sent) per day or week. A visually hidden table carries the same data for screen readers. */
function VolumeChart({ d }: { d: InboxStats }) {
  const max = niceMax(Math.max(1, ...d.volume.map((b) => Math.max(b.received, b.sent))));
  const every = Math.ceil(d.volume.length / (d.granularity === "week" ? 7 : 8));
  const n = d.volume.length;
  return (
    <Card id="stats-volume" title={d.granularity === "week" ? "Email volume per week" : "Email volume per day"} legend={<Legend />}>
      <div className="flex gap-2">
        <div className="flex h-48 flex-col justify-between text-right text-[10.5px] leading-none text-fg-3" aria-hidden><span>{max}</span><span>{Number.isInteger(max / 2) ? max / 2 : ""}</span><span>0</span></div>
        <div className="min-w-0 flex-1">
          <div className="relative flex h-48 items-end gap-[3px] border-b border-l border-line pb-px" aria-hidden data-testid="volume-bars">
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
            {d.volume.map((b) => (
              <div key={b.start} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-px" title={`${bucketLabel(b.start, d.granularity, true)}: ${b.received} received, ${b.sent} sent`}>
                <div className="w-1/2 max-w-3 rounded-t-sm bg-accent-500 transition-[filter] group-hover:brightness-125" style={{ height: `${(b.received / max) * 100}%` }} />
                <div className="w-1/2 max-w-3 rounded-t-sm bg-sky-400 transition-[filter] group-hover:brightness-125" style={{ height: `${(b.sent / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="relative mt-1 h-4" aria-hidden>
            {d.volume.map((b, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every / 2) ? (
              <span key={b.start} className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-fg-3" style={{ left: `${((i + 0.5) / n) * 100}%` }}>{bucketLabel(b.start, d.granularity)}</span>
            ) : null)}
          </div>
        </div>
      </div>
      <table className="sr-only">
        <caption>Email volume</caption>
        <thead><tr><th>{d.granularity === "week" ? "Week" : "Day"}</th><th>Received</th><th>Sent</th></tr></thead>
        <tbody>{d.volume.map((b) => <tr key={b.start}><td>{bucketLabel(b.start, d.granularity, true)}</td><td>{b.received}</td><td>{b.sent}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}

function TopSenders({ d }: { d: InboxStats }) {
  const max = Math.max(1, ...d.topSenders.map((s) => s.count));
  return (
    <Card id="stats-senders" title="Top senders">
      {d.topSenders.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-fg-3">No received mail in this period.</p>
      ) : (
        <ol className="space-y-2.5" aria-label="Top senders">
          {d.topSenders.map((s) => (
            <li key={s.email}>
              <Link to={`/app/search?${new URLSearchParams({ q: `from:${s.email}` })}`} className="group flex items-center gap-3 rounded-lg" title={`Search mail from ${s.email}`}>
                <Avatar name={s.name} email={s.email} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-fg group-hover:underline">{displayName(s)}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-fg-2">{s.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    <div className="h-full rounded-full bg-gradient-to-r from-accent-600 to-accent-400" style={{ width: `${(s.count / max) * 100}%` }} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ResponseChart({ d }: { d: InboxStats }) {
  const max = Math.max(1, ...d.response.buckets.map((b) => b.count));
  return (
    <Card id="stats-response" title="How fast you reply">
      {d.response.replies === 0 ? (
        <p className="py-6 text-center text-[13px] text-fg-3">No replies in this period yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Reply time distribution">
          {d.response.buckets.map((b) => (
            <li key={b.id} className="flex items-center gap-3 text-[12.5px]">
              <span className="w-20 shrink-0 text-fg-2">{b.label}</span>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface-2" aria-hidden>
                <div className="h-full rounded-md bg-accent-500/80" style={{ width: `${(b.count / max) * 100}%` }} />
              </div>
              <span className="w-14 shrink-0 text-right tabular-nums text-fg-2">{b.count} <span className="text-fg-3">({Math.round((b.count / d.response.replies) * 100)}%)</span></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HoursChart({ d }: { d: InboxStats }) {
  const max = Math.max(1, ...d.byHour);
  const total = d.byHour.reduce((a, b) => a + b, 0);
  return (
    <Card id="stats-hours" title="When mail arrives">
      {total === 0 ? (
        <p className="py-4 text-center text-[13px] text-fg-3">No received mail in this period.</p>
      ) : (
        <>
          <div className="flex h-28 items-end gap-[3px] border-b border-line" aria-hidden>
            {d.byHour.map((n, h) => (
              <div key={h} className="flex h-full flex-1 items-end" title={`${hourLabel(h)}: ${n}`}>
                <div className="w-full rounded-t-sm bg-accent-400/80" style={{ height: `${(n / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-fg-3" aria-hidden>
            {[0, 6, 12, 18, 23].map((h) => <span key={h}>{hourLabel(h)}</span>)}
          </div>
          <table className="sr-only">
            <caption>Received mail by hour of day</caption>
            <tbody>{d.byHour.map((n, h) => <tr key={h}><td>{hourLabel(h)}</td><td>{n}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading stats">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64" />
      <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
    </div>
  );
}
