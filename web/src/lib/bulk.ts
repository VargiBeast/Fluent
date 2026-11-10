import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ThreadSummary } from "@shared/mail";
import { api, errorMessage } from "./api";

export type BulkAction = "archive" | "inbox" | "trash" | "untrash" | "read" | "unread" | "star" | "unstar" | "label_add" | "label_remove";
export interface BulkResult { ok: number; failed: number; undo: { action: BulkAction; labelId?: string } }
export type BulkRun = Array<{ accountId: string; items: ThreadSummary[]; r: BulkResult }>;

export const plural = (n: number) => `${n} conversation${n === 1 ? "" : "s"}`;

/** One /mail/bulk request per account (label ids are per account). */
export async function runBulk(action: BulkAction, items: ThreadSummary[], labelFor?: (accountId: string) => string | undefined): Promise<BulkRun> {
  const byAcc = new Map<string, ThreadSummary[]>();
  for (const t of items) byAcc.set(t.accountId, [...(byAcc.get(t.accountId) ?? []), t]);
  const out: BulkRun = [];
  for (const [accountId, ts] of byAcc) {
    const labelId = labelFor?.(accountId);
    if (labelFor && !labelId) continue;
    const r = await api.post<BulkResult>("/mail/bulk", { items: ts.map((t) => ({ accountId, threadId: t.id })), action, ...(labelId ? { labelId } : {}) });
    out.push({ accountId, items: ts, r });
  }
  return out;
}

export async function undoBulk(res: BulkRun): Promise<void> {
  for (const x of res) await api.post("/mail/bulk", { items: x.items.map((t) => ({ accountId: x.accountId, threadId: t.id })), action: x.r.undo.action, ...(x.r.undo.labelId ? { labelId: x.r.undo.labelId } : {}) });
}

export function refreshMail(qc: QueryClient) {
  for (const k of ["threads", "thread", "labels", "snoozes", "overview"]) void qc.invalidateQueries({ queryKey: [k] });
}

/** Success toast with an Undo button that reverts every request in the run. */
export function undoToast(qc: QueryClient, message: string, res: BulkRun, opts: { description?: string; onUndone?: () => void } = {}) {
  toast.success(message, {
    description: opts.description,
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          await undoBulk(res);
          refreshMail(qc);
          opts.onUndone?.();
          toast("Undone");
        } catch (err) {
          toast.error(errorMessage(err));
        }
      },
    },
  });
}
