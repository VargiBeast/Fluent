import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SendAsAccount, SendAsIdentity, SendAsPatch } from "@shared/sendas";
import { api } from "./api";

export const SENDAS_KEY = ["send-as"] as const;

export function useSendAs() {
  return useQuery({
    queryKey: SENDAS_KEY,
    queryFn: () => api.get<{ accounts: SendAsAccount[] }>("/send-as").then((r) => r.accounts),
    staleTime: 60_000,
  });
}

export function useUpdateSendAs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, email, patch }: { accountId: string; email: string; patch: SendAsPatch }) =>
      api.patch<SendAsIdentity>(`/send-as/${accountId}/${encodeURIComponent(email)}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: SENDAS_KEY }),
  });
}

/**
 * The in-app editor supports text, bold/italic/underline, lists, quotes and links. A Gmail signature with images,
 * tables, fonts or inline styles would lose those when edited here, so the UI warns first.
 */
export function signatureNeedsRichEditor(html: string): boolean {
  return /<(img|table|font|hr)\b|\sstyle\s*=|\s(color|face|size|bgcolor)\s*=/i.test(html);
}

/** Empty signatures from Gmail are "" or a lone <br>/<div></div>; treat both as empty. */
export function isEmptySignature(html: string): boolean {
  return html.replace(/<br\s*\/?>|<\/?(div|p|span)[^>]*>|&nbsp;|\s/gi, "") === "";
}
