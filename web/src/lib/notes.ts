import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ThreadNote } from "@shared/notes";
import { api, errorMessage } from "./api";

export const noteKey = (accountId: string, threadId: string) => ["note", accountId, threadId] as const;
const notePath = (accountId: string, threadId: string) => `/notes/${encodeURIComponent(accountId)}/${encodeURIComponent(threadId)}`;

export function useThreadNote(accountId: string, threadId: string) {
  return useQuery({
    queryKey: noteKey(accountId, threadId),
    queryFn: () => api.get<{ note: ThreadNote | null }>(notePath(accountId, threadId)).then((r) => r.note),
    staleTime: 5 * 60_000,
  });
}

export function useSaveNote(accountId: string, threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.put<{ note: ThreadNote }>(notePath(accountId, threadId), { body }).then((r) => r.note),
    onSuccess: (note) => qc.setQueryData(noteKey(accountId, threadId), note),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useDeleteNote(accountId: string, threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(notePath(accountId, threadId)),
    onSuccess: () => qc.setQueryData(noteKey(accountId, threadId), null),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** What the editor would save: trimmed text, or null when there's nothing to keep. */
export function noteDraft(text: string): string | null {
  const t = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  return t.trim() ? t : null;
}
