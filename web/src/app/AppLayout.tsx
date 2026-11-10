import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import * as RD from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/lib/session";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Sidebar } from "./Sidebar";
import { ComposerProvider, useComposer } from "./composer/context";
import { ComposerHost } from "./composer/Composer";
import { ShortcutsProvider } from "./Shortcuts";
import { Splash } from "@/components/Splash";
import { CopilotProvider } from "./copilot/context";
import { CopilotHost } from "./copilot/Copilot";

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
          <RD.Overlay className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
          <RD.Content className="fixed inset-y-0 left-0 z-50 w-[290px] max-w-[85vw] border-r border-line bg-surface shadow-[var(--shadow)] animate-in lg:hidden" aria-describedby={undefined}>
            <RD.Title className="sr-only">Navigation</RD.Title>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </RD.Content>
        </RD.Portal>
      </RD.Root>
      <main id="main" className="min-w-0 flex-1">
        <Outlet />
      </main>
      <ComposerHost />
      <CopilotHost />
    </div>
  );
}

function useGlobalShortcuts() {
  const navigate = useNavigate();
  const composer = useComposer();
  const pendingG = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible" || stopped) return;
      try {
        const r = await api.get<{ changed: boolean; newInbox: number }>("/mail/sync");
        if (r.changed) {
          void qc.invalidateQueries({ queryKey: ["threads"] });
          void qc.invalidateQueries({ queryKey: ["labels"] });
        }
        if (r.newInbox > 0) {
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
  }, [qc, notif?.inApp, notif?.desktop]);
}
