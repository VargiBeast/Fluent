import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Kbd } from "@/components/ui/misc";

const Ctx = createContext<{ open: () => void }>({ open: () => {} });

const GROUPS: Array<[string, Array<[string, string]>]> = [
  ["Navigation", [["j / k", "Next / previous conversation"], ["Enter", "Open selected conversation"], ["Esc", "Close conversation"], ["/", "Search"], ["g then i", "Go to Inbox"], ["g then o", "Go to AI Overview"], ["g then s", "Go to Starred"]]],
  ["Actions", [["c", "Compose"], ["r", "Reply"], ["a", "Reply all"], ["f", "Forward"], ["e", "Archive"], ["#", "Move to Trash (asks first)"], ["s", "Star / unstar"], ["u", "Mark as unread"], ["z", "Snooze or remind"], ["b", "Save to / remove from Read later"]]],
  ["Compose", [["⌘/Ctrl + Enter", "Send"], ["⌘/Ctrl + ;", "Insert a template"], ["Esc", "Close composer (draft kept)"]]],
  ["Copilot", [["⌘/Ctrl + J", "Open or close Copilot"], ["⌘/Ctrl + K", "Command palette: go anywhere, run actions, ask Copilot"]]],
  ["Help", [["?", "Show this list"]]],
];

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Ctx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" wide>
        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map(([g, items]) => (
            <div key={g}>
              <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-fg-3">{g}</h3>
              <dl className="space-y-1.5">
                {items.map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-3 text-[13px]">
                    <dt className="text-fg-2">{d}</dt>
                    <dd><Kbd>{k}</Kbd></dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useShortcutsDialog() {
  return useContext(Ctx);
}
