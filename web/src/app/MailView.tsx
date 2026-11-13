import { useCallback, useEffect, useState } from "react";
import { singleKeysOff } from "@/lib/prefs";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { ThreadSummary } from "@shared/mail";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { ThreadList } from "./ThreadList";
import { Reader } from "./reader/Reader";
import { useCopilot } from "./copilot/context";
import { SidebarContext } from "./AppLayout";

export function MailView() {
  const { folder = "inbox", accountId, threadId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const copilot = useCopilot();
  const fullPane = session?.settings?.appearance.readingPane === "full";
  const selectedKey = accountId && threadId ? `${accountId}:${threadId}` : undefined;
  const idx = threads.findIndex((t) => `${t.accountId}:${t.id}` === selectedKey);
  const search = params.toString();

  const go = useCallback((t: ThreadSummary | undefined) => {
    if (t) navigate(`/app/${folder}/${t.accountId}/${t.id}${search ? `?${search}` : ""}`);
  }, [folder, navigate, search]);
  const close = useCallback(() => navigate(`/app/${folder}${search ? `?${search}` : ""}`), [folder, navigate, search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (singleKeysOff(e)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (e.key === "j") {
        e.preventDefault();
        go(threads[idx + 1] ?? (idx < 0 ? threads[0] : undefined));
      } else if (e.key === "k") {
        e.preventDefault();
        if (idx > 0) go(threads[idx - 1]);
      } else if (e.key === "Enter" && idx < 0 && threads[0]) {
        go(threads[0]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threads, idx, go]);

  useEffect(() => {
    if (selectedKey) document.querySelector(`[data-thread-id="${threadId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedKey, threadId]);

  const hasThread = Boolean(selectedKey);
  return (
    <div className="flex h-full min-h-0">
      <div
        className={cn(
          "h-full min-h-0 w-full shrink-0 border-r border-line bg-surface lg:w-[380px] xl:w-[420px]",
          hasThread && "hidden",
          hasThread && !fullPane && "lg:block",
        )}
      >
        <ThreadList onOpenSidebar={() => SidebarContext.open()} selectedKey={selectedKey} onThreadsChange={setThreads} />
      </div>
      <div className={cn("h-full min-h-0 min-w-0 flex-1 bg-bg", !hasThread && "hidden lg:block", fullPane && !hasThread && "lg:hidden")}>
        <Reader
          accountId={accountId}
          threadId={threadId}
          folder={folder}
          onClose={close}
          onOpenCopilot={() => copilot.open()}
          position={idx >= 0 ? { index: idx, total: threads.length, prev: idx > 0 ? () => go(threads[idx - 1]) : undefined, next: idx < threads.length - 1 ? () => go(threads[idx + 1]) : undefined } : undefined}
        />
      </div>
    </div>
  );
}
