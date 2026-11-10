import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const KEY = "fluent.installHint.dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIosSafari(ua = navigator.userAgent): boolean {
  return /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** A one-time, dismissible "Install app" hint on phones. Android/Chrome uses the native prompt; iOS gets a short tip. */
export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(() => localStorage.getItem(KEY) === "1" || isStandalone());

  useEffect(() => {
    if (hidden) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (isIosSafari() && window.innerWidth < 1024) setIos(true);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [hidden]);

  const dismiss = () => {
    localStorage.setItem(KEY, "1");
    setHidden(true);
  };
  if (hidden || (!deferred && !ios)) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-2xl border border-line-strong bg-surface p-3 text-[13px] shadow-[var(--shadow)] animate-in lg:hidden">
      <img src="/icons/icon-192.png" alt="" className="size-9 rounded-xl" />
      <p className="min-w-0 flex-1 text-fg-2">
        {deferred ? <>Install FLUENT on your home screen for a full-screen app.</> : <>Install FLUENT: tap <Share className="inline size-3.5 align-[-2px]" aria-label="Share" /> then <b className="text-fg">Add to Home Screen</b>.</>}
      </p>
      {deferred && (
        <button type="button" onClick={async () => { await deferred.prompt(); dismiss(); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-accent-fg">
          <Download className="size-3.5" /> Install
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label="Dismiss install hint" className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2 hover:text-fg"><X className="size-4" /></button>
    </div>
  );
}
