import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { singleKeysOff } from "@/lib/prefs";
import { Navigate, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { PenSquare } from "lucide-react";
import * as RD from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Sidebar } from "./Sidebar";
import { ComposerProvider, useComposer } from "./composer/context";
import { ShortcutsProvider } from "./Shortcuts";
import { Splash } from "@/components/Splash";
import { CopilotProvider, useCopilot } from "./copilot/context";
import { CopilotHost } from "./copilot/Copilot";
import { CommandPalette } from "./CommandPalette";
import { InstallHint } from "./InstallHint";
import { FocusBanner } from "./FocusMode";
import { useFocusMode } from "@/lib/focus";
import { setPrefs } from "@/lib/prefs";

export const SidebarContext = { open: () => {} };

export function AppLayout() {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!session?.user) return <Navigate to={`/?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!session.onboarded && !location.pathname.startsWith("/app/onboarding")) return <Navigate to="/app/onboarding" replace />;
  return (
    <ComposerProvider>
      <ShortcutsProvider>
        <CopilotProvider>
          <Shell />
        </CopilotProvider>
      </ShortcutsProvider>
    </ComposerProvider>
  );
}

function Shell() {
  const { session } = useSession();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const onboarding = location.pathname.startsWith("/app/onboarding");
  const density = session?.settings?.appearance.density ?? "comfortable";
  SidebarContext.open = () => setDrawer(true);
  const g = session?.settings?.general;
  const keys = session?.settings?.shortcuts.enabled ?? true;
  setPrefs({ language: g?.language ?? "auto", timeZone: g?.timeZone ?? "auto", shortcuts: keys });
  useGlobalShortcuts();
  useMailSync();

  if (onboarding) return <Outlet />;
  return (
    <div className={cn("flex h-full overflow-hidden bg-bg", density === "compact" ? "density-compact" : "density-comfortable")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-white">Skip to content</a>
      <aside className="hidden w-[256px] shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>
      <RD.Root open={drawer} onOpenChange={setDrawer}>
        <RD.Portal>
          <RD.Overlay data-drawer-overlay="" className="fixed inset-x-0 top-0 z-40 h-[100dvh] min-h-full bg-black/55 lg:hidden" />
          <RD.Content className="fixed left-0 top-0 z-50 box-border flex h-[100dvh] min-h-full w-[290px] max-w-[85vw] flex-col border-r border-line bg-surface pb-[var(--sab)] pt-[var(--sat)] shadow-[var(--shadow)] animate-in lg:hidden" aria-describedby={undefined}>
            <RD.Title className="sr-only">Navigation</RD.Title>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </RD.Content>
        </RD.Portal>
      </RD.Root>
      <main id="main" className="flex min-w-0 flex-1 flex-col">
        <FocusBanner />
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </main>
      <LazyComposer />
      <CopilotHost />
      <PaletteHost />
      <ComposeFab />
      <InstallHint />
    </div>
  );
}

/** Mobile: the one floating action on list screens, a Compose pill. Copilot lives in the search pill and ⌘J. */
function ComposeFab() {
  const composer = useComposer();
  const { isOpen } = useCopilot();
  const inThread = useMatch("/app/:folder/:accountId/:threadId");
  const inSettings = useMatch("/app/settings/*");
  const inOnboarding = useMatch("/app/onboarding/*");
  const inAccount = useMatch("/app/account");
  if (isOpen || composer.requests.length > 0 || inThread || inSettings || inOnboarding || inAccount) return null;
  return (
    <button
      type="button"
      onClick={() => composer.open({ mode: "new" })}
      aria-label="Compose"
      data-fab=""
      className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 items-center gap-2.5 rounded-2xl bg-accent px-5 text-[15px] font-semibold text-accent-fg shadow-[0_4px_14px_-4px_rgba(0,0,0,0.4)] animate-in active:scale-95 lg:hidden"
    >
      <PenSquare className="size-[18px]" aria-hidden /> Compose
    </button>
  );
}

function PaletteHost() {
  const { paletteOpen, setPaletteOpen } = useCopilot();
  return <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />;
}

function useGlobalShortcuts() {
  const navigate = useNavigate();
  const composer = useComposer();
  const pendingG = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (singleKeysOff(e)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (pendingG.current && Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        const dest = { i: "/app/inbox", o: "/app/overview", s: "/app/starred", d: "/app/drafts", t: "/app/sent" }[e.key];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
        return;
      }
      if (e.key === "g") pendingG.current = Date.now();
      else if (e.key === "c") {
        e.preventDefault();
        composer.open({ mode: "new" });
      } else if (e.key === "/") {
        e.preventDefault();
        const input = document.getElementById("mail-search");
        if (input) input.focus();
        else navigate("/app/inbox?focus=search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, composer]);
}

/** Poll Gmail history for changes while the tab is visible; refresh views and notify about new mail. */
function useMailSync() {
  const qc = useQueryClient();
  const { session } = useSession();
  const notif = session?.settings?.notifications;
  const focusing = useFocusMode().active && session?.settings?.focus.muteToasts !== false;
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible" || stopped) return;
      try {
        const r = await api.get<{ changed: boolean; newInbox: number; snoozeReturned?: number; remindersDue?: number }>("/mail/sync");
        if (r.changed) {
          void qc.invalidateQueries({ queryKey: ["threads"] });
          void qc.invalidateQueries({ queryKey: ["labels"] });
        }
        const back = (r.snoozeReturned ?? 0) + (r.remindersDue ?? 0);
        if (back > 0) {
          void qc.invalidateQueries({ queryKey: ["snoozes"] });
          if (notif?.inApp !== false) toast(back === 1 ? "1 conversation is back in your Inbox" : `${back} conversations are back in your Inbox`, { description: r.remindersDue ? "Including a reminder: nobody replied yet." : "Your snooze ended." });
        }
        if (r.newInbox > 0 && !focusing) {
          const msg = r.newInbox === 1 ? "1 new email" : `${r.newInbox} new emails`;
          if (notif?.inApp !== false) toast(msg, { description: "Your inbox was updated." });
          if (notif?.desktop && "Notification" in window && Notification.permission === "granted" && document.hidden === false) {
            new Notification("FLUENT", { body: msg, silent: false });
          }
        }
      } catch {
        // Sync is best-effort; errors surface in the list views.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 45_000);
    const onVis = () => void tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [qc, notif?.inApp, notif?.desktop, focusing]);
}

// The rich-text composer (TipTap/ProseMirror) is the heaviest part of the app, so it loads on first use,
// and is prefetched once the browser is idle so opening it still feels instant.
const loadComposer = () => import("./composer/Composer");
const ComposerHost = lazy(() => loadComposer().then((m) => ({ default: m.ComposerHost })));

function LazyComposer() {
  const { requests } = useComposer();
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadComposer());
  }, []);
  if (!requests.length) return null;
  return <Suspense fallback={null}><ComposerHost /></Suspense>;
}
