import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage, qs } from "./api";
import type { Category, DraftSummary, Folder, LabelsResponse, ThreadAction, ThreadDetail, ThreadPage } from "@shared/mail";

export interface ListArgs {
  folder: Folder;
  account?: string;
  category?: Category;
  label?: string;
  q?: string;
  filter?: "unanswered";
}

export function threadsKey(a: ListArgs) {
  return ["threads", a.folder, a.account ?? "all", a.category ?? "", a.label ?? "", a.q ?? "", a.filter ?? ""] as const;
}

export function useThreads(a: ListArgs, enabled = true) {
  return useInfiniteQuery({
    queryKey: threadsKey(a),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<ThreadPage>(`/mail/threads${qs({ folder: a.folder, account: a.account, category: a.category, label: a.label, q: a.q, filter: a.filter, cursor: pageParam, limit: 25 })}`, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function useThread(accountId: string | undefined, threadId: string | undefined) {
  return useQuery({
    queryKey: ["thread", accountId, threadId],
    enabled: Boolean(accountId && threadId),
    queryFn: ({ signal }) => api.get<ThreadDetail>(`/mail/threads/${accountId}/${threadId}`, signal),
    staleTime: 60_000,
  });
}

export function useLabels(account?: string) {
  return useQuery({
    queryKey: ["labels", account ?? "all"],
    queryFn: () => api.get<LabelsResponse & { accounts: Array<{ error?: string | null }> }>(`/mail/labels${qs({ account })}`),
    staleTime: 60_000,
  });
}

export function useDrafts(account?: string, enabled = true) {
  return useQuery({
    queryKey: ["drafts", account ?? "all"],
    enabled,
    queryFn: () => api.get<{ drafts: DraftSummary[] }>(`/mail/drafts${qs({ account })}`),
    staleTime: 15_000,
  });
}

type Patch = Partial<{ unread: boolean; starred: boolean; important: boolean; remove: boolean }>;

const ACTION_PATCH: Record<ThreadAction, Patch> = {
  star: { starred: true },
  unstar: { starred: false },
  read: { unread: false },
  unread: { unread: true },
  important: { important: true },
  unimportant: { important: false },
  archive: { remove: true },
  trash: { remove: true },
  spam: { remove: true },
  inbox: { remove: true },
  untrash: { remove: true },
  notspam: { remove: true },
};

const LABEL_FOR: Partial<Record<ThreadAction, [string, boolean]>> = {
  star: ["STARRED", true], unstar: ["STARRED", false], read: ["UNREAD", false], unread: ["UNREAD", true],
  important: ["IMPORTANT", true], unimportant: ["IMPORTANT", false],
};

/** Thread action with optimistic list/reader updates, synced to Gmail and rolled back on failure. */
export function useThreadAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { accountId: string; threadId: string; action: ThreadAction; folder?: Folder }) =>
      api.post(`/mail/threads/${v.accountId}/${v.threadId}/action`, { action: v.action }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["threads"] });
      const patch = ACTION_PATCH[v.action];
      const removeFromList = patch.remove && !(v.action === "inbox" && v.folder !== "archive");
      const snapshots = qc.getQueriesData<InfiniteData<ThreadPage>>({ queryKey: ["threads"] });
      qc.setQueriesData<InfiniteData<ThreadPage>>({ queryKey: ["threads"] }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            threads: p.threads
              .filter((t) => !(removeFromList && t.id === v.threadId && t.accountId === v.accountId))
              .map((t) => (t.id === v.threadId && t.accountId === v.accountId ? { ...t, ...stripRemove(patch) } : t)),
          })),
        };
      });
      const threadKey = ["thread", v.accountId, v.threadId];
      const prevThread = qc.getQueryData<ThreadDetail>(threadKey);
      const lf = LABEL_FOR[v.action];
      if (prevThread && lf) {
        const [label, on] = lf;
        qc.setQueryData<ThreadDetail>(threadKey, {
          ...prevThread,
          ...stripRemove(patch),
          labelIds: on ? [...new Set([...prevThread.labelIds, label])] : prevThread.labelIds.filter((l) => l !== label),
          messages: label === "UNREAD" ? prevThread.messages.map((m) => ({ ...m, unread: on })) : prevThread.messages,
        });
      }
      return { snapshots, prevThread, threadKey };
    },
    onError: (err, _v, ctx) => {
      ctx?.snapshots.forEach(([k, d]) => qc.setQueryData(k, d));
      if (ctx?.prevThread) qc.setQueryData(ctx.threadKey, ctx.prevThread);
      toast.error(errorMessage(err));
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: ["labels"] });
      void qc.invalidateQueries({ queryKey: ["thread", v.accountId, v.threadId] });
      if (ACTION_PATCH[v.action].remove) void qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

function stripRemove(p: Patch) {
  const { remove: _r, ...rest } = p;
  return rest;
}

export function useLabelMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { accountId: string; threadId: string; add?: string[]; remove?: string[] }) =>
      api.post(`/mail/threads/${v.accountId}/${v.threadId}/labels`, { add: v.add ?? [], remove: v.remove ?? [] }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["thread", v.accountId, v.threadId] });
      void qc.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function attachmentUrl(accountId: string, messageId: string, attachmentId: string, filename: string): string {
  return `/api/mail/attachments/${accountId}/${messageId}/${attachmentId}${qs({ name: filename })}`;
}
