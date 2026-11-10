import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface CopilotCtx {
  isOpen: boolean;
  /** Open Copilot, optionally with text; `autoSend` submits it right away. */
  open: (prefill?: string, autoSend?: boolean, mode?: "ask") => void;
  close: () => void;
  setOpen: (v: boolean) => void;
  prefill: { text: string; autoSend: boolean; n: number; mode?: "ask" };
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
}

const Ctx = createContext<CopilotCtx>({ isOpen: false, open: () => {}, close: () => {}, setOpen: () => {}, prefill: { text: "", autoSend: false, n: 0 }, paletteOpen: false, setPaletteOpen: () => {} });

/** One Copilot for the whole app, opened from buttons or ⌘K / Ctrl+K anywhere. */
export function CopilotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState<CopilotCtx["prefill"]>({ text: "", autoSend: false, n: 0 });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const open = useCallback((p?: string, autoSend = false, mode?: "ask") => {
    setPrefill((x) => ({ text: p ?? "", autoSend, n: x.n + 1, mode }));
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPaletteOpen(false);
        setIsOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        // ⌘K opens the command palette (which also asks Copilot). Inside the composer it stays the editor's link shortcut.
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("[data-composer]")) return;
        e.preventDefault();
        setIsOpen(false);
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ isOpen, open, close, setOpen: setIsOpen, prefill, paletteOpen, setPaletteOpen }), [isOpen, open, close, prefill, paletteOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCopilot() {
  return useContext(Ctx);
}
