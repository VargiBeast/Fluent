import * as RD from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import {
  Archive, Clock, CornerDownLeft, File, Inbox, Keyboard, Mail, MailOpen, Moon, PenSquare, Search, Send, Settings, ShieldCheck, Sparkles, Star, Sun, Tag, Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { useUpdateSettings } from "@/lib/settings";
import { useComposer } from "./composer/context";
import { useCopilot } from "./copilot/context";
import { useShortcutsDialog } from "./Shortcuts";
import { filterCommands, type Command } from "./commands";

interface Runnable extends Command {
  icon: ReactNode;
  run: () => void;
}

/** Run a reader command (same handlers as its keyboard shortcuts) once the palette has closed. */
function pressAfterClose(key: string) {
  window.setTimeout(() => {
    // Prefer the reader's own toolbar button for that shortcut (labels end in "(key)"), so behaviour is identical.
    const btn = [...document.querySelectorAll<HTMLButtonElement>("article button[aria-label]")].find((b) => b.getAttribute("aria-label")!.endsWith(`(${key})`));
    if (btn) btn.click();
    else window.dispatchEvent(new CustomEvent("fluent:reader-command", { detail: key }));
  }, 80);
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const composer = useComposer();
  const copilot = useCopilot();
  const shortcuts = useShortcutsDialog();
  const { session } = useSession();
  const update = useUpdateSettings();
  const inThread = useMatch("/app/:folder/:accountId/:threadId");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Runnable[]>(() => {
    const go = (path: string) => () => navigate(path);
    const theme = session?.settings?.appearance.theme ?? "dark";
    const list: Runnable[] = [
      { id: "copilot", group: "Copilot", title: "Open Copilot", keywords: "ai ask assistant", icon: <Sparkles />, run: () => copilot.open() },
      { id: "compose", group: "Actions", title: "Compose new email", keywords: "write new message", shortcut: "c", icon: <PenSquare />, run: () => composer.open({ mode: "new" }) },
      { id: "search", group: "Actions", title: "Search mail", keywords: "find", shortcut: "/", icon: <Search />, run: () => navigate("/app/inbox?focus=search") },
      { id: "go-overview", group: "Go to", title: "AI Overview", keywords: "briefing radar follow-up", shortcut: "g o", icon: <Sparkles />, run: go("/app/overview") },
      { id: "go-inbox", group: "Go to", title: "Inbox", shortcut: "g i", icon: <Inbox />, run: go("/app/inbox") },
      { id: "go-starred", group: "Go to", title: "Starred", shortcut: "g s", icon: <Star />, run: go("/app/starred") },
      { id: "go-snoozed", group: "Go to", title: "Snoozed", icon: <Clock />, run: go("/app/snoozed") },
      { id: "go-sent", group: "Go to", title: "Sent", shortcut: "g t", icon: <Send />, run: go("/app/sent") },
      { id: "go-drafts", group: "Go to", title: "Drafts", shortcut: "g d", icon: <File />, run: go("/app/drafts") },
      { id: "go-archive", group: "Go to", title: "Archive", icon: <Archive />, run: go("/app/archive") },
      { id: "go-trash", group: "Go to", title: "Trash", icon: <Trash2 />, run: go("/app/trash") },
      { id: "settings", group: "Settings", title: "Open settings", keywords: "preferences", icon: <Settings />, run: go("/app/settings/profile") },
      { id: "privacy", group: "Settings", title: "Privacy dashboard", keywords: "ai log exclusions export", icon: <ShieldCheck />, run: go("/app/settings/privacy") },
      { id: "labels", group: "Settings", title: "Labels & filters", icon: <Tag />, run: go("/app/settings/labels") },
      {
        id: "theme", group: "Settings", title: theme === "light" ? "Switch to dark theme" : "Switch to light theme", keywords: "appearance mode dark light",
        icon: theme === "light" ? <Moon /> : <Sun />, run: () => update.mutate({ appearance: { theme: theme === "light" ? "dark" : "light" } }),
      },
      { id: "shortcuts", group: "Settings", title: "Keyboard shortcuts", shortcut: "?", icon: <Keyboard />, run: () => shortcuts.open() },
    ];
    if (inThread) {
      list.splice(1, 0,
        { id: "t-reply", group: "Conversation", title: "Reply", shortcut: "r", icon: <Mail />, run: () => pressAfterClose("r") },
        { id: "t-archive", group: "Conversation", title: "Archive conversation", shortcut: "e", icon: <Archive />, run: () => pressAfterClose("e") },
        { id: "t-star", group: "Conversation", title: "Star / unstar", shortcut: "s", icon: <Star />, run: () => pressAfterClose("s") },
        { id: "t-unread", group: "Conversation", title: "Mark as unread", shortcut: "u", icon: <MailOpen />, run: () => pressAfterClose("u") },
        { id: "t-snooze", group: "Conversation", title: "Snooze or remind", keywords: "later remind", shortcut: "z", icon: <Clock />, run: () => pressAfterClose("z") },
        { id: "t-trash", group: "Conversation", title: "Move to Trash", keywords: "delete", shortcut: "#", icon: <Trash2 />, run: () => pressAfterClose("#") },
      );
    }
    return list;
  }, [navigate, composer, copilot, shortcuts, update, session?.settings?.appearance.theme, inThread]);

  const results = useMemo(() => {
    const r = filterCommands(commands, q);
    // Free text always offers to ask Copilot, so ⌘K doubles as the Copilot entry point.
    if (q.trim().length > 1) r.push({ id: "ask", group: "Copilot", title: `Ask Copilot: “${q.trim()}”`, icon: <Sparkles />, run: () => copilot.open(q.trim(), true) });
    return r;
  }, [commands, q, copilot]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runAt = (i: number) => {
    const c = results[i];
    if (!c) return;
    onOpenChange(false);
    c.run();
  };

  let lastGroup = "";
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] animate-in" />
        <RD.Content
          data-palette=""
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[var(--shadow)] animate-in"
        >
          <RD.Title className="sr-only">Command palette</RD.Title>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <Search className="size-4 text-fg-3" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); runAt(active); }
              }}
              placeholder="Type a command, or ask Copilot anything…"
              aria-label="Command"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={results[active] ? `cmd-${results[active]!.id}` : undefined}
              className="h-12 flex-1 bg-transparent text-[14.5px] text-fg outline-none placeholder:text-fg-3"
            />
            <kbd className="rounded border border-line px-1.5 text-[10.5px] text-fg-3">Esc</kbd>
          </div>
          <div ref={listRef} id="palette-list" role="listbox" aria-label="Commands" className="scroll-thin max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
            {results.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-fg-3">No matching commands.</p>}
            {results.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <div key={c.id}>
                  {header && <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wider text-fg-3">{header}</p>}
                  <div
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => runAt(i)}
                    className={cn("flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors", i === active ? "bg-surface-3 text-fg" : "text-fg-2")}
                  >
                    <span className={cn("[&>svg]:size-4", c.group === "Copilot" ? "text-accent-ink" : "text-fg-3")}>{c.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.shortcut && <kbd className="rounded border border-line px-1.5 text-[10.5px] text-fg-3">{c.shortcut}</kbd>}
                    {i === active && <CornerDownLeft className="size-3.5 text-fg-3" aria-hidden />}
                  </div>
                </div>
              );
            })}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
