import { useCallback } from "react";
import { toast } from "sonner";
import type { Address, ThreadDetail, ThreadPage } from "@shared/mail";
import { api, errorMessage, qs } from "@/lib/api";
import { fmtAddr } from "@/lib/compose";
import { draftBody, draftSubject, matchesRecipient, recipientQuery, type VoiceCommand } from "@/lib/voiceCommand";
import { useComposer } from "../composer/context";

async function search(q: string): Promise<ThreadPage["threads"]> {
  return (await api.get<ThreadPage>(`/mail/threads${qs({ folder: "all", q, limit: 5 })}`)).threads;
}

/** Find the person's address in recent mail (from them first, then to them). */
async function findAddress(recipient: string): Promise<Address | null> {
  for (const field of ["from", "to"] as const) {
    const q = recipientQuery(field, recipient);
    if (!q) return null;
    for (const t of await search(q)) {
      const hit = [t.from, ...t.to, ...t.participants].find((a) => a.email && matchesRecipient(a, recipient));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Turns a spoken command into a Gmail *draft* opened in the composer. It never sends: the user reviews the draft and
 * presses Send themselves (or doesn't).
 */
export function useVoiceDraft(onOpened?: () => void) {
  const composer = useComposer();
  return useCallback(async (cmd: VoiceCommand) => {
    const body = draftBody(cmd);
    const toastId = toast.loading(`Drafting for ${cmd.recipient}…`);
    try {
      if (cmd.kind === "reply") {
        const q = recipientQuery("from", cmd.recipient);
        const [latest] = q ? await search(q) : [];
        if (latest) {
          const thread = await api.get<ThreadDetail>(`/mail/threads/${latest.accountId}/${latest.id}`);
          const real = thread.messages.filter((m) => !m.isDraft);
          const message = [...real].reverse().find((m) => !m.isFromMe && matchesRecipient(m.from, cmd.recipient)) ?? real[real.length - 1];
          if (message) {
            toast.dismiss(toastId);
            onOpened?.();
            composer.open({ mode: "reply", thread, message, bodyText: body, voice: true });
            return;
          }
        }
      }
      const addr = await findAddress(cmd.recipient);
      toast.dismiss(toastId);
      onOpened?.();
      composer.open({ mode: "new", to: addr ? fmtAddr(addr) : undefined, subject: draftSubject(cmd.message), bodyText: body, voice: true });
      if (!addr) toast(`Couldn't find ${cmd.recipient} in your recent mail`, { description: "Add the recipient to the draft." });
    } catch (e) {
      toast.error(errorMessage(e), { id: toastId });
    }
  }, [composer, onOpened]);
}
