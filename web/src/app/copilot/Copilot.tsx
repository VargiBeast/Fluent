import * as RD from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Mail, ShieldCheck, Sparkles, X } from "lucide-react";
import type { ThreadSummary } from "@shared/mail";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/cn";
import { displayName, listDate } from "@/lib/format";
import { IconButton } from "@/components/ui/Button";

interface Msg {
  role: "user" | "assistant" | "error";
  text: string;
  citations?: ThreadSummary[];
  meta?: string;
}

interface CopilotResponse {
  answer: string;
  citations: ThreadSummary[];
  searched?: number;
  excluded?: number;
}

const INBOX_PROMPTS = ["What needs my attention today?", "Which emails haven't I answered?", "Summarize what's new this week", "Are there any deadlines coming up?"];
const THREAD_PROMPTS = ["What is this email asking me to do?", "Is there a deadline?", "Does this look like phishing?"];

export function CopilotPanel({ open, onOpenChange, context }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context?: { accountId: string; threadId: string };
}) {
  const { config, session } = useSession();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [useThread, setUseThread] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scoped = Boolean(context) && useThread;
  const aiReady = Boolean(config?.ai) && session?.settings?.ai.enabled !== false;

  useEffect(() => {
    setUseThread(true);
  }, [context?.accountId, context?.threadId]);
  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollIntoView, which must not become an effect cleanup.
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const ask = useMutation({
    mutationFn: (p: { message: string; action: "ask" | "explain" }) =>
      api.post<CopilotResponse>("/ai/copilot", { message: p.message, action: p.action, ...(scoped && context ? { context } : {}) }),
    onSuccess: (r) => {
      const meta = r.searched !== undefined ? `Searched ${r.searched} conversation${r.searched === 1 ? "" : "s"}${r.excluded ? ` · ${r.excluded} excluded by your privacy settings` : ""}` : undefined;
      setMessages((m) => [...m, { role: "assistant", text: r.answer, citations: r.citations, meta }]);
    },
    onError: (e) => setMessages((m) => [...m, { role: "error", text: errorMessage(e) }]),
  });

  const send = (text: string, action: "ask" | "explain" = "ask") => {
    const t = text.trim();
    if (!t || ask.isPending) return;
    setMessages((m) => [...m, { role: "user", text: t }]);
    setInput("");
    ask.mutate({ message: t, action });
  };

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/40 animate-in lg:bg-black/20" />
        <RD.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-[var(--shadow)] animate-in sm:w-[420px]"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent-400"><Sparkles className="size-4" /></span>
              <div>
                <RD.Title className="text-[14.5px] font-semibold text-fg">FLUENT Copilot</RD.Title>
                <RD.Description className="text-[11.5px] text-fg-3">Answers come only from your email. It can't send or delete anything.</RD.Description>
              </div>
            </div>
            <RD.Close asChild><IconButton label="Close copilot"><X className="size-4" /></IconButton></RD.Close>
          </header>

          <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {!aiReady ? (
              <div className="rounded-xl border border-line bg-surface-2 p-4 text-[13px] text-fg-2">
                {!config?.ai ? "AI isn’t configured on this server. Add an AI provider key (see docs/SETUP.md) to use Copilot." : "AI features are turned off in Settings → AI."}
              </div>
            ) : messages.length === 0 ? (
              <div className="space-y-4 animate-in">
                <div className="ai-block rounded-xl p-4 text-[13px] text-fg-2">
                  <p className="font-medium text-ai-title">Ask anything about your inbox</p>
                  <p className="mt-1">Copilot searches your Gmail, reads the most relevant conversations and answers with links to the emails it used.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(scoped ? THREAD_PROMPTS : INBOX_PROMPTS).map((p) => (
                    <button key={p} type="button" onClick={() => send(p)} className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-left text-[12.5px] text-fg-2 hover:border-[var(--ai-border)] hover:text-fg">
                      {p}
                    </button>
                  ))}
                  {scoped && (
                    <button type="button" onClick={() => send("Explain this email in plain language", "explain")} className="rounded-full border border-[var(--ai-border)] bg-accent-soft px-3 py-1.5 text-[12.5px] text-ai-title">
                      Explain this email simply
                    </button>
                  )}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                      m.role === "user" && "bg-accent text-accent-fg",
                      m.role === "assistant" && "ai-block text-fg",
                      m.role === "error" && "border border-danger/40 bg-danger/10 text-danger",
                    )}
                  >
                    {m.text}
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-fg-3">Sources</p>
                        {m.citations.map((t) => (
                          <button
                            key={`${t.accountId}:${t.id}`}
                            type="button"
                            onClick={() => {
                              onOpenChange(false);
                              navigate(`/app/all/${t.accountId}/${t.id}`);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left hover:border-[var(--ai-border)]"
                          >
                            <Mail className="size-3.5 shrink-0 text-accent-400" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium text-fg">{t.subject || "(no subject)"}</span>
                              <span className="block truncate text-[11px] text-fg-3">{displayName(t.from)} · {listDate(t.lastDate)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {m.meta && <p className="mt-2 text-[11px] text-fg-3">{m.meta}</p>}
                  </div>
                </div>
              ))
            )}
            {ask.isPending && (
              <div className="flex items-center gap-2 text-[12.5px] text-fg-3" role="status">
                <span className="flex gap-1"><Dot /><Dot d={150} /><Dot d={300} /></span> Reading your email…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {context && (
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUseThread((v) => !v)}
                  aria-pressed={scoped}
                  className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px]", scoped ? "border-[var(--ai-border)] bg-accent-soft text-ai-title" : "border-line text-fg-3")}
                >
                  <Mail className="size-3" /> {scoped ? "Asking about this email" : "Asking about whole inbox"}
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-line bg-surface-2 p-1.5 focus-within:border-[var(--ai-border)]">
              <label htmlFor="copilot-input" className="sr-only">Ask Copilot</label>
              <textarea
                id="copilot-input"
                ref={inputRef}
                rows={1}
                value={input}
                disabled={!aiReady}
                maxLength={1000}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={scoped ? "Ask about this email…" : "Ask about your inbox…"}
                className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] text-fg outline-none placeholder:text-fg-3"
              />
              <button type="submit" disabled={!input.trim() || ask.isPending || !aiReady} aria-label="Send question" className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg disabled:opacity-40">
                <ArrowUp className="size-4" />
              </button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-3"><ShieldCheck className="size-3" /> Email content is treated as untrusted data. Logged in Settings → Privacy.</p>
          </form>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return <span className="size-1.5 animate-bounce rounded-full bg-accent-400" style={{ animationDelay: `${d}ms` }} />;
}
