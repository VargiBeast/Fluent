import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, Archive, CheckCircle2, ExternalLink, Mail, MailMinus, Menu, RefreshCw } from "lucide-react";
import { UNSUB_RANGES, type ArchiveResult, type NewsletterScan, type NewsletterSender, type UnsubRange } from "@shared/unsubscribe";
import { api, errorMessage, qs } from "@/lib/api";
import { cn } from "@/lib/cn";
import { displayName, relative } from "@/lib/format";
import { openRateLabel, openRateTone, orderSenders, readUnsubscribed, senderKey, writeUnsubscribed, type UnsubscribedMap } from "@/lib/newsletters";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { SidebarContext } from "./AppLayout";

/**
 * Unsubscribe assistant: newsletter senders (List-Unsubscribe) ranked by how rarely you open them.
 * Every action here needs a click (mailto and archiving also need a confirm); nothing happens automatically.
 */
export function NewslettersPage() {
  const [params] = useSearchParams();
  const account = params.get("account") ?? undefined;
  const [days, setDays] = useState<UnsubRange>(90);
  const { session } = useSession();
  const userId = session?.user?.id ?? "anon";
  const qc = useQueryClient();
  const queryKey = ["newsletters", days, account ?? "all"] as const;
  const q = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.get<NewsletterScan>(`/newsletters/senders${qs({ days, account })}`, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [unsubscribed, setUnsubscribed] = useState<UnsubscribedMap>(() => readUnsubscribed(userId));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mailtoFor, setMailtoFor] = useState<NewsletterSender | null>(null);
  const [archiveFor, setArchiveFor] = useState<NewsletterSender[] | null>(null);

  const senders = useMemo(() => orderSenders(q.data?.senders ?? [], unsubscribed), [q.data, unsubscribed]);

  const markDone = (s: NewsletterSender) => {
    const next = { ...unsubscribed, [senderKey(s)]: new Date().toISOString() };
    setUnsubscribed(next);
    writeUnsubscribed(userId, next);
  };

  const unsub = useMutation({
    mutationFn: (v: { s: NewsletterSender; method: "one-click" | "mailto" }) =>
      api.post("/newsletters/unsubscribe", { accountId: v.s.accountId, messageId: v.s.messageId, method: v.method, confirm: true }),
    onSuccess: (_r, v) => {
      markDone(v.s);
      setMailtoFor(null);
      toast.success(v.method === "mailto" ? `Unsubscribe email sent to ${v.s.methods.mailto?.address}` : `Unsubscribed from ${displayName(v.s)}`, v.s.inInbox > 0 ? {
        action: { label: `Archive ${v.s.inInbox}`, onClick: () => setArchiveFor([v.s]) },
      } : undefined);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const undoArchive = useMutation({
    mutationFn: (undo: ArchiveResult["undo"]) => api.post<{ restored: number }>("/newsletters/archive/undo", { items: undo }),
    onSuccess: (r) => { toast.success(`Moved ${r.restored} back to the Inbox`); void qc.invalidateQueries({ queryKey: ["newsletters"] }); void qc.invalidateQueries({ queryKey: ["threads"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const archive = useMutation({
    mutationFn: (list: NewsletterSender[]) => api.post<ArchiveResult>("/newsletters/archive", { senders: list.map((s) => ({ accountId: s.accountId, email: s.email })), confirm: true }),
    onSuccess: (r) => {
      setArchiveFor(null);
      setSelected(new Set());
      toast.success(r.archived ? `Archived ${r.archived} email${r.archived === 1 ? "" : "s"}` : "Nothing left in the Inbox to archive", r.archived ? {
        action: { label: "Undo", onClick: () => undoArchive.mutate(r.undo) },
      } : undefined);
      void qc.invalidateQueries({ queryKey: ["newsletters"] });
      void qc.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const chosen = senders.filter((s) => selected.has(senderKey(s)));
  const toggle = (s: NewsletterSender) => setSelected((prev) => {
    const n = new Set(prev);
    const k = senderKey(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const archiveCount = (archiveFor ?? []).reduce((a, s) => a + s.inInbox, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 lg:px-8">
        <IconButton label="Open navigation" className="lg:hidden" onClick={() => SidebarContext.open()}><Menu className="size-5" /></IconButton>
        <h1 className="flex items-center gap-2 text-[17px] font-semibold text-fg"><MailMinus className="size-4 text-accent-400" /> Unsubscribe</h1>
        <div className="ml-auto flex items-center gap-2">
          <div role="radiogroup" aria-label="Time range" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
            {UNSUB_RANGES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={days === r} onClick={() => setDays(r)} className={cn("h-7 rounded-md px-2.5 text-[12.5px]", days === r ? "bg-surface-3 font-medium text-fg shadow-sm" : "text-fg-3 hover:text-fg")}>
                {r} days
              </button>
            ))}
          </div>
          <IconButton label="Rescan" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} />
          </IconButton>
        </div>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 lg:px-8">
          <p className="text-[13px] text-fg-3">
            Newsletters and mailing lists that offer an unsubscribe option, least-opened first. Nothing happens until you click.
          </p>
          {q.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
          ) : q.isError ? (
            <EmptyState icon={<AlertCircle className="size-5" />} title="Couldn't scan your mail" description={errorMessage(q.error)} action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
          ) : q.data && senders.length === 0 ? (
            <EmptyState icon={<Mail className="size-5" />} title="No newsletters found" description={`No mail with an unsubscribe header in the last ${days} days.`} />
          ) : q.data ? (
            <>
              {q.data.errors.length > 0 && (
                <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-fg-2">
                  <AlertTriangle className="size-4 text-warning" aria-hidden /> Some accounts couldn't be read: {q.data.errors.map((e) => e.message).join(" ")}
                </p>
              )}
              <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                <span className="text-[12.5px] text-fg-3">
                  {senders.length} sender{senders.length === 1 ? "" : "s"} · {q.data.sample.messages.toLocaleString()} emails scanned{q.data.sample.truncated ? ` (latest ${q.data.sample.limit} per account)` : ""}
                </span>
                <div className="flex-1" />
                <Button size="sm" icon={<Archive className="size-3.5" />} disabled={!chosen.length} onClick={() => setArchiveFor(chosen)}>
                  Archive all from {chosen.length || "selected"}{chosen.length ? ` sender${chosen.length === 1 ? "" : "s"}` : ""}
                </Button>
              </div>
              <ul className="space-y-2" aria-label="Newsletter senders">
                {senders.map((s) => (
                  <SenderRow
                    key={senderKey(s)}
                    s={s}
                    selected={selected.has(senderKey(s))}
                    onToggle={() => toggle(s)}
                    unsubscribedAt={unsubscribed[senderKey(s)]}
                    busy={unsub.isPending && unsub.variables?.s === s}
                    onOneClick={() => unsub.mutate({ s, method: "one-click" })}
                    onMailto={() => setMailtoFor(s)}
                    onArchive={() => setArchiveFor([s])}
                    onLinkOpened={() => markDone(s)}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(mailtoFor)}
        onOpenChange={(o) => !o && setMailtoFor(null)}
        title="Send an unsubscribe email?"
        description="This sender unsubscribes by email. MailIQ will send this one message from your account:"
        confirmLabel="Send unsubscribe email"
        loading={unsub.isPending}
        onConfirm={() => mailtoFor && unsub.mutate({ s: mailtoFor, method: "mailto" })}
      >
        {mailtoFor?.methods.mailto && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-line bg-surface-2 p-3 text-[13px]">
            <dt className="text-fg-3">From</dt><dd className="truncate text-fg">{session?.accounts?.find((a) => a.id === mailtoFor.accountId)?.email}</dd>
            <dt className="text-fg-3">To</dt><dd className="truncate text-fg">{mailtoFor.methods.mailto.address}</dd>
            <dt className="text-fg-3">Subject</dt><dd className="truncate text-fg">{mailtoFor.methods.mailto.subject}</dd>
          </dl>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(archiveFor)}
        onOpenChange={(o) => !o && setArchiveFor(null)}
        title={archiveFor?.length === 1 ? `Archive all from ${displayName(archiveFor[0]!)}?` : `Archive all from ${archiveFor?.length ?? 0} senders?`}
        description={`Moves every Inbox email from ${archiveFor?.length === 1 ? archiveFor[0]!.email : "these senders"} to Archive in Gmail (about ${archiveCount} found in the last ${days} days, plus any older ones). Nothing is deleted, and you can undo.`}
        confirmLabel="Archive all"
        loading={archive.isPending}
        onConfirm={() => archiveFor && archive.mutate(archiveFor)}
      />
    </div>
  );
}

function SenderRow({ s, selected, onToggle, unsubscribedAt, busy, onOneClick, onMailto, onArchive, onLinkOpened }: {
  s: NewsletterSender;
  selected: boolean;
  onToggle: () => void;
  unsubscribedAt?: string;
  busy: boolean;
  onOneClick: () => void;
  onMailto: () => void;
  onArchive: () => void;
  onLinkOpened: () => void;
}) {
  const tone = openRateTone(s.openRate);
  const name = displayName(s);
  return (
    <li className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5", unsubscribedAt && "opacity-70")} data-sender={s.email}>
      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={selected} onChange={onToggle} aria-label={`Select ${name}`} />
      <Avatar name={s.name} email={s.email} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13.5px] font-medium text-fg">{name}</span>
          <span className="truncate text-[12px] text-fg-3">{s.email}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-fg-3">
          <span className={cn("font-medium", tone === "low" ? "text-danger" : tone === "mid" ? "text-warning" : "text-fg-2")}>{openRateLabel(s)}</span>
          <span>{s.inInbox} in Inbox</span>
          <span>Last {relative(s.lastAt)}</span>
          {unsubscribedAt && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" aria-hidden />Unsubscribed {relative(unsubscribedAt)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {s.methods.oneClick ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={onOneClick} disabled={Boolean(unsubscribedAt)} aria-label={`Unsubscribe from ${name}`}>Unsubscribe</Button>
        ) : s.methods.mailto ? (
          <Button size="sm" variant="secondary" onClick={onMailto} disabled={Boolean(unsubscribedAt)} aria-label={`Unsubscribe from ${name} by email`}>Unsubscribe…</Button>
        ) : s.methods.link ? (
          <a href={s.methods.link} target="_blank" rel="noopener noreferrer nofollow" onClick={onLinkOpened}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-fg hover:bg-surface-3"
            title="Opens the sender's unsubscribe page in a new tab">
            Open unsubscribe page <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
        <IconButton label={`Archive all from ${name}`} size="sm" onClick={onArchive} disabled={s.inInbox === 0}><Archive className="size-4" /></IconButton>
      </div>
    </li>
  );
}
