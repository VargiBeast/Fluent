import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { MessageDetail, ThreadDetail } from "@shared/mail";

export type ComposeRequest =
  | { mode: "new"; accountId?: string; to?: string; subject?: string; bodyText?: string; aiGenerated?: boolean; voice?: boolean }
  | { mode: "reply" | "replyAll" | "forward"; thread: ThreadDetail; message: MessageDetail; bodyText?: string; aiGenerated?: boolean; voice?: boolean }
  | { mode: "draft"; accountId: string; draftId: string };

interface ComposerState {
  requests: Array<ComposeRequest & { key: number }>;
  open: (r: ComposeRequest) => void;
  close: (key: number) => void;
}

const Ctx = createContext<ComposerState | null>(null);

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<Array<ComposeRequest & { key: number }>>([]);
  // Only one composer at a time keeps the UI calm; opening another replaces it after its own unsaved-check.
  const open = useCallback((r: ComposeRequest) => setRequests([{ ...r, key: Date.now() }]), []);
  const close = useCallback((key: number) => setRequests((rs) => rs.filter((r) => r.key !== key)), []);
  const value = useMemo(() => ({ requests, open, close }), [requests, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useComposer() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useComposer outside provider");
  return v;
}
