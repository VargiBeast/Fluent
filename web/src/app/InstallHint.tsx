import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** Soft prompt to install MailIQ as a PWA on supported browsers. */
export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("mailiq-install-dismissed") === "1");

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (dismissed || !deferred) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg sm:left-auto">
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-medium text-fg">Install MailIQ</p>
        <p className="text-fg-3">Add to your home screen for a faster, app-like experience.</p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-fg"
        onClick={async () => {
          await deferred.prompt();
          setDeferred(null);
        }}
      >
        Install
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-fg-3 hover:bg-surface-2"
        onClick={() => {
          localStorage.setItem("mailiq-install-dismissed", "1");
          setDismissed(true);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
