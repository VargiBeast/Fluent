import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Moon, ShieldCheck, Sparkles, Sun } from "lucide-react";
import { useSession } from "@/lib/session";
import { useUpdateSettings } from "@/lib/settings";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Field";
import { Logo } from "@/components/ui/misc";

const STEPS = ["Account", "Look & feel", "AI", "Privacy"] as const;

export function OnboardingPage() {
  const { session, config } = useSession();
  const update = useUpdateSettings();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const s = session!.settings!;
  const accounts = session?.accounts ?? [];
  const blocked = accounts.length > 0 && accounts.every((a) => a.status !== "active");
  const scopeError = params.get("error") === "insufficient_scopes" || blocked;

  const finish = () => update.mutate({ onboarded: true }, { onSuccess: () => navigate("/app/inbox", { replace: true }) });

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <ol className="flex items-center gap-1.5" aria-label="Setup progress">
            {STEPS.map((label, i) => (
              <li key={label} aria-current={i === step ? "step" : undefined} className={cn("h-1.5 w-8 rounded-full", i <= step ? "bg-accent" : "bg-surface-3")}>
                <span className="sr-only">{label}{i < step ? " (done)" : ""}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow)] animate-in">
          {step === 0 && (
            <>
              <h1 className="text-xl font-semibold text-fg">Welcome to FLUENT{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}</h1>
              <p className="mt-1 text-[13.5px] text-fg-3">Let's get your inbox set up. This takes less than a minute.</p>
              <ul className="mt-5 space-y-2">
                {accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
                    <Avatar name={a.name} email={a.email} src={a.picture} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{a.email}</span>
                    {a.status === "active" ? <span className="flex items-center gap-1 text-xs text-success"><Check className="size-3.5" /> Gmail connected</span> : <span className="flex items-center gap-1 text-xs text-danger"><AlertTriangle className="size-3.5" /> No Gmail access</span>}
                  </li>
                ))}
              </ul>
              {scopeError && (
                <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-[13px] text-fg-2">
                  FLUENT needs permission to read and organise your Gmail. On Google's consent screen, make sure the Gmail checkbox is ticked.
                  <Button className="mt-3" size="sm" variant="primary" onClick={() => { window.location.href = `/api/auth/google/start?mode=link${accounts[0] ? `&account=${accounts[0].id}` : ""}`; }}>Grant Gmail access</Button>
                </div>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <h1 className="text-xl font-semibold text-fg">Choose your look</h1>
              <p className="mt-1 text-[13.5px] text-fg-3">You can change this any time in Settings.</p>
              <div className="mt-5 grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
                {([["dark", "Dark", Moon], ["light", "Light", Sun], ["system", "System", Sparkles]] as const).map(([v, label, Icon]) => (
                  <button key={v} type="button" role="radio" aria-checked={s.appearance.theme === v} onClick={() => update.mutate({ appearance: { theme: v } })} className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 text-[13px]", s.appearance.theme === v ? "border-accent bg-accent-soft text-fg" : "border-line bg-surface-2 text-fg-2 hover:text-fg")}>
                    <Icon className="size-5" />{label}
                  </button>
                ))}
              </div>
              <div className="mt-4"><Switch label="Compact density" description="Fit more conversations on screen." checked={s.appearance.density === "compact"} onChange={(v) => update.mutate({ appearance: { density: v ? "compact" : "comfortable" } })} /></div>
            </>
          )}
          {step === 2 && (
            <>
              <h1 className="text-xl font-semibold text-fg">Your AI assistant</h1>
              <p className="mt-1 text-[13.5px] text-fg-3">FLUENT can summarize threads, draft replies, and answer questions about your mail. It never sends, deletes or forwards anything on its own.</p>
              {!config?.ai && <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[12.5px] text-fg-2">AI isn't configured on this server yet, so these preferences take effect later.</p>}
              <div className="mt-3 divide-y divide-line">
                <Switch label="Enable AI features" checked={s.ai.enabled} onChange={(enabled) => update.mutate({ ai: { enabled } })} />
                <Switch label="Summarize emails when I open them" checked={s.ai.autoSummarize} disabled={!s.ai.enabled} onChange={(autoSummarize) => update.mutate({ ai: { autoSummarize } })} />
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h1 className="flex items-center gap-2 text-xl font-semibold text-fg"><ShieldCheck className="size-5 text-accent-400" /> Your privacy</h1>
              <ul className="mt-4 space-y-2.5 text-[13.5px] text-fg-2">
                <li>• Email bodies are never stored by FLUENT — they're read live from Gmail.</li>
                <li>• Remote images are blocked by default so senders can't track when you open mail.</li>
                <li>• Every AI request is listed in Settings → Privacy, and you can exclude senders and labels from AI.</li>
                <li>• You can export or delete your FLUENT data at any time.</li>
              </ul>
            </>
          )}
          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((x) => x - 1)}>Back</Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" disabled={step === 0 && blocked} onClick={() => setStep((x) => x + 1)}>Continue</Button>
            ) : (
              <Button variant="primary" loading={update.isPending} onClick={finish}>Open my inbox</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
