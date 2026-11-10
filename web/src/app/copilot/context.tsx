import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface CopilotCtx {
  isOpen: boolean;
  open: (prefill?: string) => void;
  close: () => void;
  setOpen: (v: boolean) => void;
  prefill: string;
}

const Ctx = createContext<CopilotCtx>({ isOpen: false, open: () => {}, close: () => {}, setOpen: () => {}, prefill: "" });

/** One Copilot for the whole app, opened from buttons or ⌘K / Ctrl+K anywhere. */
export function CopilotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const open = useCallback((p?: string) => {
    setPrefill(p ?? "");
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        // Don't steal ⌘K from the composer's link shortcut or other dialogs.
        const inOtherDialog = [...document.querySelectorAll("[role=dialog]")].some((d) => !d.hasAttribute("data-copilot"));
        if (inOtherDialog) return;
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ isOpen, open, close, setOpen: setIsOpen, prefill }), [isOpen, open, close, prefill]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCopilot() {
  return useContext(Ctx);
}
