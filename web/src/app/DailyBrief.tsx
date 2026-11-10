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
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/misc";

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const lang = () => (navigator.language || "en").slice(0, 24);
const today = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const DISMISS_KEY = "fluent.brief.dismissed";

/** Fetches (and, the first time each day, generates) the Copilot daily brief. */
export function useDailyBrief() {
  return useQuery({
    queryKey: ["brief", today()],
    queryFn: () => api.get<DailyBrief>(`/ai/brief?${new URLSearchParams({ tz: tz(), lang: lang() })}`),
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/** Copilot's morning summary. `compact` is the collapsible strip at the top of the inbox; the Overview shows it open. */
export function DailyBriefCard({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const q = useDailyBrief();
  const [open, setOpen] = useState(!compact);
  const [dismissed, setDismissed] = useState(() => compact && localStorage.getItem(DISMISS_KEY) === today());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const b = q.data;

  if (dismissed) return null;
  if (q.isLoading) return <div className={cn(compact ? "mx-3 mt-3" : "")}><Skeleton className="h-14 rounded-2xl" /></div>;
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
    <section aria-label="Daily brief" data-testid="daily-brief" className={cn("ai-block rounded-2xl", compact ? "mx-3 mt-3" : "")}>
      <div className="flex items-start gap-3 px-4 py-3">
        <Sun className="mt-0.5 size-4 shrink-0 text-ai-title" aria-hidden />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => compact && setOpen((o) => !o)} aria-expanded={open} disabled={!compact}>
          <p className="text-[12px] font-medium uppercase tracking-wide text-ai-title">Daily brief</p>
          <p className={cn("mt-0.5 text-[13.5px] text-fg", compact && !open && "line-clamp-1")}>
            {b.headline ?? (empty ? "Nothing needs your attention right now." : "Here's what matters today.")}
          </p>
          {counts && <p className="mt-0.5 text-[12px] text-fg-3">{counts}</p>}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {b.aiStatus === "ok" && (
            <IconButton label="Regenerate brief" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </IconButton>
          )}
          {compact && (
            <>
              <IconButton label={open ? "Collapse brief" : "Expand brief"} size="sm" onClick={() => setOpen((o) => !o)}>
                <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
              </IconButton>
              <IconButton label="Hide brief for today" size="sm" onClick={() => { localStorage.setItem(DISMISS_KEY, today()); setDismissed(true); }}>
                <X className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      </div>
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
