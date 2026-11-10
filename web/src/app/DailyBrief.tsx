import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, MessageSquareReply, RefreshCw, Star, Sun, X } from "lucide-react";
import { toast } from "sonner";
import type { BriefItem, DailyBrief } from "@shared/brief";
import { api, errorMessage } from "@/lib/api";
import { plural, refreshMail, runBulk, undoToast } from "@/lib/bulk";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/format";
import { effectiveLanguage, effectiveTimeZone } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/misc";

const tz = effectiveTimeZone;
const lang = effectiveLanguage;
const today = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz() }).format(new Date());

/** Settings > Copilot & AI: the brief can be off, or held back until a chosen hour (in the user's time zone). */
function useBriefGate() {
  const ai = useSession().session?.settings?.ai;
  const on = ai?.dailyBrief !== false;
  const hour = ai?.briefHour ?? 0;
  const nowHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz() }).format(new Date()));
  return { on, ready: on && nowHour >= hour, hour };
}
const DISMISS_KEY = "fluent.brief.dismissed";

/** Fetches (and, the first time each day, generates) the Copilot daily brief. */
export function useDailyBrief(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["brief", today()],
    queryFn: () => api.get<DailyBrief>(`/ai/brief?${new URLSearchParams({ tz: tz(), lang: lang() })}`),
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/** Copilot's morning summary. `compact` is the collapsible strip at the top of the inbox; the Overview shows it open. */
export function DailyBriefCard({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const gate = useBriefGate();
  const q = useDailyBrief(gate.ready);
  const [open, setOpen] = useState(!compact);
  const [dismissed, setDismissed] = useState(() => compact && localStorage.getItem(DISMISS_KEY) === today());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const b = q.data;

  if (dismissed) return null;
  if (!gate.ready) {
    if (compact) return null;
    return (
      <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-fg-3">
        {gate.on ? `Your daily brief appears at ${String(gate.hour).padStart(2, "0")}:00.` : "The daily brief is turned off."}{" "}
        <Link to="/app/settings/ai" className="text-accent-ink hover:underline">Change in Settings</Link>
      </p>
    );
  }
  if (q.isLoading) return <div className={cn(compact ? "mx-3 mt-1" : "")}><Skeleton className={compact ? "h-11 rounded-2xl" : "h-14 rounded-2xl"} /></div>;
  if (q.isError || !b) return compact ? null : <p className="text-[13px] text-fg-3">Daily brief unavailable: {errorMessage(q.error)}</p>;

  const counts = [
    b.important.length && `${b.important.length} important`,
    b.awaitingReply.length && `${b.awaitingReply.length} awaiting your reply`,
    b.safeToArchive.length && `${b.safeToArchive.length} safe to archive`,
  ].filter(Boolean).join(" · ");
  const empty = !b.important.length && !b.awaitingReply.length && !b.safeToArchive.length;

  const drop = (keys: Set<string>) =>
    qc.setQueryData<DailyBrief>(["brief", today()], (d) => d && { ...d, safeToArchive: d.safeToArchive.filter((x) => !keys.has(`${x.thread.accountId}:${x.thread.id}`)) });

  const archiveAll = async () => {
    const items = b.safeToArchive.map((x) => x.thread);
    setBusy(true);
    try {
      const res = await runBulk("archive", items);
      const ok = res.reduce((s, x) => s + x.r.ok, 0);
      const failed = res.reduce((s, x) => s + x.r.failed, 0);
      const before = b.safeToArchive;
      drop(new Set(items.map((t) => `${t.accountId}:${t.id}`)));
      setConfirm(false);
      refreshMail(qc);
      undoToast(qc, `Archived ${plural(ok)}`, res, {
        description: failed ? `${failed} couldn't be changed.` : undefined,
        onUndone: () => qc.setQueryData<DailyBrief>(["brief", today()], (d) => d && { ...d, safeToArchive: before }),
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api.get<DailyBrief>(`/ai/brief?${new URLSearchParams({ tz: tz(), lang: lang(), refresh: "1" })}`);
      qc.setQueryData(["brief", today()], fresh);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section aria-label="Daily brief" data-testid="daily-brief" className={cn("rounded-2xl", compact ? cn("mx-3 mt-1", open ? "ai-block" : "bg-surface-2") : "ai-block")}>
      {compact ? (
        <div className="flex h-11 items-center gap-2.5 pl-3.5 pr-1">
          <Sun className="size-4 shrink-0 text-ai-title" aria-hidden />
          <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <span className="sr-only">Daily brief: </span>
            <span className="min-w-0 truncate text-[13px] text-fg-2">{b.headline ?? (empty ? "Nothing needs your attention right now." : "Here's what matters today.")}</span>
            <ChevronDown className={cn("size-4 shrink-0 text-fg-3 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && b.aiStatus === "ok" && (
            <IconButton label="Regenerate brief" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </IconButton>
          )}
          <IconButton label="Hide brief for today" size="sm" onClick={() => { localStorage.setItem(DISMISS_KEY, today()); setDismissed(true); }}>
            <X className="size-4" />
          </IconButton>
        </div>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3">
          <Sun className="mt-0.5 size-4 shrink-0 text-ai-title" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium uppercase tracking-wide text-ai-title">Daily brief</p>
            <p className="mt-0.5 text-[13.5px] text-fg">{b.headline ?? (empty ? "Nothing needs your attention right now." : "Here's what matters today.")}</p>
            {counts && <p className="mt-0.5 text-[12px] text-fg-3">{counts}</p>}
          </div>
          {b.aiStatus === "ok" && (
            <IconButton label="Regenerate brief" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </IconButton>
          )}
        </div>
      )}
      {compact && open && counts && <p className="-mt-1 px-4 pb-2 pl-10 text-[12px] text-fg-3">{counts}</p>}
      {open && !empty && (
        <div className={cn("grid gap-4 border-t border-[var(--ai-border)] px-4 py-3", !compact && "md:grid-cols-3")}>
          <BriefList title="Most important" icon={<Star className="size-3.5" />} items={b.important} max={compact ? 3 : undefined} />
          <BriefList title="Awaiting your reply" icon={<MessageSquareReply className="size-3.5" />} items={b.awaitingReply} max={compact ? 3 : undefined} />
          <div>
            <BriefList title="Safe to archive" icon={<Archive className="size-3.5" />} items={b.safeToArchive} max={compact ? 3 : undefined} />
            {b.safeToArchive.length > 0 && (
              <Button size="sm" variant="ghost" className="mt-2" icon={<Archive className="size-3.5" />} onClick={() => setConfirm(true)}>
                Archive {b.safeToArchive.length}
              </Button>
            )}
          </div>
        </div>
      )}
      {open && (b.aiStatus === "disabled" || b.aiStatus === "not_configured" || b.aiStatus === "error" || b.excluded > 0) && (
        <p className="border-t border-[var(--ai-border)] px-4 py-2 text-[11.5px] text-fg-3">
          {b.aiStatus === "disabled" ? "AI is off in Settings, so this brief uses Gmail signals only." : b.aiStatus === "not_configured" ? "Gmail signals only (no AI provider configured)." : b.aiStatus === "error" ? "The AI brief couldn't be written right now; showing Gmail signals." : ""}
          {b.excluded > 0 ? ` ${b.excluded} conversation${b.excluded === 1 ? " was" : "s were"} left out by your privacy settings.` : ""}
        </p>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Archive ${plural(b.safeToArchive.length)}?`}
        description={`${b.safeToArchive.map((x) => x.thread.subject || "(no subject)").slice(0, 6).join(" · ")}${b.safeToArchive.length > 6 ? " …" : ""}. They leave the inbox but stay in All Mail, and you can undo right after.`}
        confirmLabel="Archive"
        loading={busy}
        onConfirm={() => void archiveAll()}
      />
    </section>
  );
}

function BriefList({ title, icon, items, max }: { title: string; icon: React.ReactNode; items: BriefItem[]; max?: number }) {
  const shown = max ? items.slice(0, max) : items;
  return (
    <div className="min-w-0">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-fg-2">{icon} {title}</p>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-fg-3">Nothing here.</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((x) => (
            <li key={`${x.thread.accountId}:${x.thread.id}`}>
              <Link to={`/app/inbox/${x.thread.accountId}/${x.thread.id}`} className="block rounded-lg px-2 py-1 hover:bg-surface-2">
                <span className="block truncate text-[12.5px] font-medium text-fg">{x.thread.subject || "(no subject)"}</span>
                <span className="block truncate text-[11.5px] text-fg-3">{displayName(x.thread.from)} · {x.reason}</span>
              </Link>
            </li>
          ))}
          {shown.length < items.length && (
            <li><Link to="/app/overview" className="px-2 text-[11.5px] text-ai-title hover:underline">+{items.length - shown.length} more in AI Overview</Link></li>
          )}
        </ul>
      )}
    </div>
  );
}
