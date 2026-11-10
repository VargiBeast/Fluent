import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "./api";

export interface ReadLaterItem { accountId: string; threadId: string; addedAt: string }

export const READ_LATER_KEY = ["read-later"] as const;
export const readLaterKey = (accountId: string, threadId: string) => `${accountId}:${threadId}`;

export function useReadLater() {
  return useQuery({
    queryKey: READ_LATER_KEY,
    queryFn: () => api.get<{ items: ReadLaterItem[] }>("/mail/read-later").then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useIsReadLater(accountId: string, threadId: string): boolean {
  const q = useReadLater();
  return Boolean(q.data?.some((i) => i.accountId === accountId && i.threadId === threadId));
}

/** Add or remove, with an optimistic update of the saved set. */
export function useToggleReadLater() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { accountId: string; threadId: string; save: boolean }) =>
      v.save ? api.post("/mail/read-later", { accountId: v.accountId, threadId: v.threadId }) : api.del(`/mail/read-later/${v.accountId}/${v.threadId}`),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: READ_LATER_KEY });
      const prev = qc.getQueryData<ReadLaterItem[]>(READ_LATER_KEY);
      qc.setQueryData<ReadLaterItem[]>(READ_LATER_KEY, toggled(prev ?? [], v.accountId, v.threadId, v.save));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(READ_LATER_KEY, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: READ_LATER_KEY });
      void qc.invalidateQueries({ queryKey: ["threads", "later"] });
    },
  });
}

export function toggled(items: ReadLaterItem[], accountId: string, threadId: string, save: boolean, now = new Date()): ReadLaterItem[] {
  const rest = items.filter((i) => !(i.accountId === accountId && i.threadId === threadId));
  return save ? [{ accountId, threadId, addedAt: now.toISOString() }, ...rest] : rest;
}
