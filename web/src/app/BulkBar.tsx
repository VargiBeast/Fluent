import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Clock, Inbox, Loader2, Mail, MailOpen, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ThreadSummary } from "@shared/mail";
import { api, errorMessage } from "@/lib/api";
import { useLabels } from "@/lib/mail";
import { snoozePresets } from "@/lib/snooze";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/Menu";
import { cn } from "@/lib/cn";

type BulkAction = "archive" | "inbox" | "trash" | "untrash" | "read" | "unread" | "star" | "unstar" | "label_add" | "label_remove";
interface BulkResult { ok: number; failed: number; undo: { action: BulkAction; labelId?: string } }

const PAST: Record<string, string> = { archive: "Archived", inbox: "Moved to Inbox", trash: "Moved to Trash", read: "Marked as read", unread: "Marked as unread", label_add: "Labelled", untrash: "Restored" };
const plural = (n: number) => `${n} conversation${n === 1 ? "" : "s"}`;

/** Bulk actions for selected conversations. Every action can be undone from its toast. */
export function BulkBar({ selected, allVisible, onSelectAll, onClear, folder }: {
  selected: ThreadSummary[];
  allVisible: boolean;
  onSelectAll: (on: boolean) => void;
  onClear: () => void;
  folder: string;
}) {
  const qc = useQueryClient();
  const labels = useLabels();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const n = selected.length;
  const refresh = () => {
    for (const k of ["threads", "thread", "labels", "snoozes"]) void qc.invalidateQueries({ queryKey: [k] });
  };

  // Per-account requests, because label ids are per account.
  const runBulk = async (action: BulkAction, items: ThreadSummary[], labelFor?: (accountId: string) => string | undefined): Promise<Array<{ accountId: string; items: ThreadSummary[]; r: BulkResult }>> => {
    const byAcc = new Map<string, ThreadSummary[]>();
    for (const t of items) byAcc.set(t.accountId, [...(byAcc.get(t.accountId) ?? []), t]);
    const out = [];
    for (const [accountId, ts] of byAcc) {
      const labelId = labelFor?.(accountId);
      if (labelFor && !labelId) continue;
      const r = await api.post<BulkResult>("/mail/bulk", { items: ts.map((t) => ({ accountId, threadId: t.id })), action, ...(labelId ? { labelId } : {}) });
      out.push({ accountId, items: ts, r });
    }
    return out;
  };

  const act = async (action: BulkAction, label?: { name: string }) => {
    const items = [...selected];
    setBusy(action);
    try {
      const labelFor = label ? (acc: string) => labels.data?.accounts.find((a) => a.accountId === acc)?.labels.find((l) => l.name === label.name)?.id : undefined;
      const res = await runBulk(action, items, labelFor);
      const ok = res.reduce((s, x) => s + x.r.ok, 0);
      const failed = res.reduce((s, x) => s + x.r.failed, 0);
      onClear();
      refresh();
      toast.success(`${PAST[action] ?? "Updated"} ${plural(ok)}${label ? ` with “${label.name}”` : ""}`, {
        description: failed ? `${failed} couldn't be changed.` : undefined,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              for (const x of res) await api.post("/mail/bulk", { items: x.items.map((t) => ({ accountId: x.accountId, threadId: t.id })), action: x.r.undo.action, ...(x.r.undo.labelId ? { labelId: x.r.undo.labelId } : {}) });
              refresh();
              toast("Undone");
            } catch (err) {
              toast.error(errorMessage(err));
            }
          },
        },
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const snooze = async (until: Date, label: string) => {
    const items = [...selected];
    setBusy("snooze");
    let ok = 0;
    try {
      for (const t of items) {
        await api.post("/mail/snoozes", { accountId: t.accountId, threadId: t.id, until: until.toISOString(), kind: "snooze" });
        ok++;
      }
      onClear();
      refresh();
      toast.success(`Snoozed ${plural(ok)} until ${label.toLowerCase()}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            for (const t of items) await api.del(`/mail/snoozes/${t.accountId}/${t.id}`).catch(() => {});
            refresh();
            toast("Undone");
          },
        },
      });
    } catch (err) {
      refresh();
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const userLabels = [...new Map((labels.data?.accounts ?? []).flatMap((a) => a.labels.filter((l) => l.type === "user" && l.name !== "Snoozed")).map((l) => [l.name, l])).values()];
  const anyUnread = selected.some((t) => t.unread);
  const inTrash = folder === "trash";
  const btn = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-fg-2 hover:bg-surface-3 hover:text-fg disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";
  const spin = (a: string, icon: React.ReactNode) => (busy === a ? <Loader2 className="size-3.5 animate-spin" /> : icon);

  return (
    <div
      role="toolbar"
      aria-label={`Bulk actions for ${plural(n)}`}
      className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-1 overflow-x-auto border-t border-line bg-surface px-2 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2 shadow-[var(--shadow)] scroll-thin animate-in lg:sticky lg:top-1 lg:mx-2 lg:mb-1 lg:rounded-xl lg:border lg:pb-2 lg:shadow-none"
    >
      <input
        type="checkbox"
        aria-label="Select all visible conversations"
        checked={allVisible}
        onChange={(e) => onSelectAll(e.target.checked)}
        className="ml-1 size-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="mr-1 shrink-0 px-1 text-[12.5px] font-semibold text-fg" aria-live="polite">{n} selected</span>
      {inTrash ? (
        <button type="button" className={btn} disabled={busy !== null} onClick={() => act("untrash")}>{spin("untrash", <Inbox className="size-3.5" />)} Restore</button>
      ) : folder === "inbox" ? (
        <button type="button" className={btn} disabled={busy !== null} onClick={() => act("archive")} title="Archive (e)">{spin("archive", <Archive className="size-3.5" />)} Archive</button>
      ) : (
        <button type="button" className={btn} disabled={busy !== null} onClick={() => act("inbox")}>{spin("inbox", <Inbox className="size-3.5" />)} Move to Inbox</button>
      )}
      {anyUnread ? (
        <button type="button" className={btn} disabled={busy !== null} onClick={() => act("read")}>{spin("read", <MailOpen className="size-3.5" />)} Mark read</button>
      ) : (
        <button type="button" className={btn} disabled={busy !== null} onClick={() => act("unread")}>{spin("unread", <Mail className="size-3.5" />)} Mark unread</button>
      )}
      {!inTrash && (
        <Menu>
          <MenuTrigger asChild><button type="button" className={btn} disabled={busy !== null}>{spin("snooze", <Clock className="size-3.5" />)} Snooze</button></MenuTrigger>
          <MenuContent>
            <MenuLabel>Snooze until…</MenuLabel>
            {snoozePresets().map((p) => <MenuItem key={p.id} icon={<Clock />} onSelect={() => void snooze(p.until, p.label)}>{p.label}</MenuItem>)}
          </MenuContent>
        </Menu>
      )}
      {userLabels.length > 0 && (
        <Menu>
          <MenuTrigger asChild><button type="button" className={btn} disabled={busy !== null}>{spin("label_add", <Tag className="size-3.5" />)} Label</button></MenuTrigger>
          <MenuContent>
            <MenuLabel>Add label</MenuLabel>
            {userLabels.map((l) => <MenuItem key={l.name} icon={<Tag />} onSelect={() => void act("label_add", { name: l.name })}>{l.name}</MenuItem>)}
          </MenuContent>
        </Menu>
      )}
      {!inTrash && (
        <button type="button" className={cn(btn, "hover:text-danger")} disabled={busy !== null} onClick={() => setConfirmTrash(true)}>{spin("trash", <Trash2 className="size-3.5" />)} Delete</button>
      )}
      <button type="button" onClick={onClear} className={cn(btn, "ml-auto")} aria-label="Clear selection (Esc)" title="Clear selection (Esc)"><X className="size-3.5" /></button>
      <ConfirmDialog
        open={confirmTrash}
        onOpenChange={setConfirmTrash}
        title={`Move ${n} email${n === 1 ? "" : "s"} to Trash?`}
        description="They stay in Trash for 30 days, and you can undo right after."
        confirmLabel={`Move ${n} to Trash`}
        danger
        onConfirm={() => { setConfirmTrash(false); void act("trash"); }}
      />
    </div>
  );
}
