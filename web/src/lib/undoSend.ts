import { toast } from "sonner";

const pending = new Set<number>();
let guardInstalled = false;

function installGuard() {
  if (guardInstalled || typeof window === "undefined") return;
  guardInstalled = true;
  // Leaving the page during the undo window would drop the message: ask first.
  window.addEventListener("beforeunload", (e) => {
    if (pending.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

export function pendingSends(): number {
  return pending.size;
}

/**
 * Delay a send so the user can undo it. `run` performs the real send after `seconds`.
 * Undo cancels the timer and calls `onUndo`. With 0 seconds it sends right away.
 */
export function sendWithUndo(opts: { seconds: number; run: () => Promise<void>; onUndo: () => void; label?: string }): { cancel: () => void } {
  if (opts.seconds <= 0) {
    void opts.run();
    return { cancel: () => {} };
  }
  installGuard();
  let done = false;
  const toastId = `undo-send-${Math.random().toString(36).slice(2)}`;
  const timer = window.setTimeout(() => {
    done = true;
    pending.delete(timer);
    toast.dismiss(toastId);
    void opts.run();
  }, opts.seconds * 1000);
  pending.add(timer);
  const cancel = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    pending.delete(timer);
    toast.dismiss(toastId);
    opts.onUndo();
  };
  toast(opts.label ?? "Sending…", {
    id: toastId,
    description: `Sending in ${opts.seconds} seconds.`,
    duration: opts.seconds * 1000 + 1000,
    action: { label: "Undo", onClick: cancel },
  });
  return { cancel };
}
