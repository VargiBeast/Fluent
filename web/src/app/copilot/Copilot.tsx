import * as RD from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Archive, ArrowUp, Check, ChevronDown, FilePen, Inbox, Loader2, Mail, MailOpen, Search, Send, ShieldCheck,
  Maximize2, Minimize2, Sparkles, Star, StarOff, Tag, Trash2, Undo2, X,
} from "lucide-react";
import type { ThreadSummary } from "@shared/mail";
import type { ActionResult, CopilotActionType, CopilotReply, ExecuteResult, PlanAction, PlanPreview } from "@shared/copilot";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/cn";
import { displayName, listDate } from "@/lib/format";
import { Button, IconButton } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/misc";
import { useCopilot } from "./context";
import { CopilotMic } from "../voice/CopilotMic";

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; citations?: ThreadSummary[]; meta?: string }
  | { id: number; role: "error"; text: string }
  | { id: number; role: "plan"; plan: PlanPreview };

const INBOX_PROMPTS = ["Archive newsletters from this week", "Star everything from my manager", "Draft follow-ups to emails waiting on a reply", "What needs my attention today?"];
const THREAD_PROMPTS = ["Draft a reply saying yes", "Archive this", "Label this as Follow-up", "What is this email asking me to do?"];

let nextId = 1;
type NewMsg = Msg extends infer M ? (M extends Msg ? Omit<M, "id"> : never) : never;

/** The app-wide Copilot panel. Mounted once in the app shell; opened with buttons or ⌘K / Ctrl+K. */
export function CopilotHost() {
  const { isOpen, setOpen, prefill } = useCopilot();
  const m = useMatch("/app/:folder/:accountId/:threadId");
  const context = m?.params.accountId && m.params.threadId && m.params.folder !== "settings" ? { accountId: m.params.accountId, threadId: m.params.threadId } : undefined;
  return <CopilotPanel open={isOpen} onOpenChange={setOpen} context={context} prefill={prefill} />;
}

export function CopilotPanel({ open, onOpenChange, context, prefill }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context?: { accountId: string; threadId: string };
  prefill?: { text: string; autoSend: boolean; n: number; mode?: "ask" };
}) {
  const { config, session } = useSession();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [useThread, setUseThread] = useState(true);
  const [expanded, setExpanded] = useState(() => localStorage.getItem("fluent.copilot.expanded") === "1");
  useEffect(() => localStorage.setItem("fluent.copilot.expanded", expanded ? "1" : "0"), [expanded]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scoped = Boolean(context) && useThread;
  const aiReady = Boolean(config?.ai) && session?.settings?.ai.enabled !== false;

  useEffect(() => setUseThread(true), [context?.accountId, context?.threadId]);
  useEffect(() => {
    if (!open || !prefill?.text) return;
    if (prefill.autoSend) send(prefill.text, false, prefill.mode === "ask");
    else setInput(prefill.text);
    // Only when a new prefill arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.n]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const push = (m: NewMsg) => setMessages((xs) => [...xs, { ...m, id: nextId++ } as Msg]);

  const ask = useMutation({
    mutationFn: (p: { message: string; explain?: boolean; ask?: boolean }) =>
      p.ask
        ? api.post<Omit<Extract<CopilotReply, { kind: "answer" }>, "kind">>("/ai/ask", { question: p.message }).then((r): CopilotReply => ({ ...r, kind: "answer" }))
        : p.explain && context
        ? api.post<{ answer: string; citations: ThreadSummary[] }>("/ai/copilot", { message: p.message, action: "explain", context }).then((r): CopilotReply => ({ kind: "answer", answer: r.answer, citations: r.citations }))
        : api.post<CopilotReply>("/copilot/plan", { instruction: p.message, ...(scoped && context ? { context } : {}) }),
    onSuccess: (r) => {
      if (r.kind === "plan") push({ role: "plan", plan: r.plan });
      else if (r.kind === "clarify") push({ role: "assistant", text: r.message });
      else {
        const meta = r.searched !== undefined
          ? [
            r.gmailQuery ? `Gmail search: ${r.gmailQuery}` : "No matching emails",
            r.searched ? `read ${r.searched} conversation${r.searched === 1 ? "" : "s"}` : "",
            r.excluded ? `${r.excluded} excluded by your privacy settings` : "",
          ].filter(Boolean).join(" · ")
          : undefined;
        push({ role: "assistant", text: r.answer, citations: r.citations, meta });
      }
    },
    onError: (e) => push({ role: "error", text: errorMessage(e) }),
  });

  const send = (text: string, explain = false, askInbox = false) => {
    const t = text.trim();
    if (!t || ask.isPending) return;
    push({ role: "user", text: t });
    setInput("");
    ask.mutate({ message: t, explain, ask: askInbox });
  };

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/40 animate-in lg:bg-black/20" />
        <RD.Content
          data-copilot=""
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            "fixed z-50 flex flex-col bg-surface shadow-[var(--shadow)] animate-in pb-[var(--sab)] pt-[var(--sat)]",
            expanded
              ? "inset-0 sm:inset-x-[max(24px,calc(50vw-480px))] sm:inset-y-[6vh] sm:rounded-2xl sm:border sm:border-line-strong"
              : "inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(600px,92vw)] sm:border-l sm:border-line",
          )}
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent-ink"><Sparkles className="size-4" /></span>
              <div>
                <RD.Title className="text-[14.5px] font-semibold text-fg">FLUENT Copilot</RD.Title>
                <RD.Description className="text-[11.5px] text-fg-3">Ask or tell it what to do. Nothing changes until you confirm.</RD.Description>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="hidden text-[11px] text-fg-3 sm:inline" title="Toggle Copilot"><Kbd>⌘J</Kbd></span>
              <IconButton label={expanded ? "Dock to the side" : "Expand Copilot"} className="hidden sm:inline-flex" onClick={() => setExpanded((v) => !v)}>
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </IconButton>
              <RD.Close asChild><IconButton label="Close copilot"><X className="size-4" /></IconButton></RD.Close>
            </div>
          </header>

          <div className={cn("scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4", expanded && "sm:px-8")} aria-live="polite">
            {!aiReady ? (
              <div className="rounded-xl border border-line bg-surface-2 p-4 text-[13px] text-fg-2">
                {!config?.ai ? "AI isn’t configured on this server. Add an AI provider key (see docs/SETUP.md) to use Copilot." : "AI features are turned off in Settings → AI."}
              </div>
            ) : messages.length === 0 ? (
              <div className="space-y-4 animate-in">
                <div className="ai-block rounded-xl p-4 text-[13px] text-fg-2">
                  <p className="font-medium text-ai-title">Ask anything, or tell Copilot what to do</p>
                  <p className="mt-1">Copilot can search, archive, star, label, mark read, move to Trash and draft replies. It shows you a plan first, and nothing happens until you confirm. Sending always needs an extra confirmation.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(scoped ? THREAD_PROMPTS : INBOX_PROMPTS).map((p) => (
                    <button key={p} type="button" onClick={() => send(p)} className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-left text-[12.5px] text-fg-2 hover:border-[var(--ai-border)] hover:text-fg">
                      {p}
                    </button>
                  ))}
                  {scoped && (
                    <button type="button" onClick={() => send("Explain this email in plain language", true)} className="rounded-full border border-[var(--ai-border)] bg-accent-soft px-3 py-1.5 text-[12.5px] text-ai-title">
                      Explain this email simply
                    </button>
                  )}
                </div>
              </div>
            ) : (
              messages.map((m) =>
                m.role === "plan" ? (
                  <PlanCard key={m.id} plan={m.plan} onOpenThread={(a, t) => { onOpenChange(false); navigate(`/app/all/${a}/${t}`); }} />
                ) : (
                  <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                        m.role === "user" && "bg-accent text-accent-fg",
                        m.role === "assistant" && "ai-block text-fg",
                        m.role === "error" && "border border-danger/40 bg-danger/10 text-danger",
                      )}
                    >
                      {m.text}
                      {m.role === "assistant" && m.citations && m.citations.length > 0 && (
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
                              <Mail className="size-3.5 shrink-0 text-accent-ink" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12.5px] font-medium text-fg">{t.subject || "(no subject)"}</span>
                                <span className="block truncate text-[11px] text-fg-3">{displayName(t.from)} · {listDate(t.lastDate)}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      {m.role === "assistant" && m.meta && <p className="mt-2 text-[11px] text-fg-3">{m.meta}</p>}
                    </div>
                  </div>
                ),
              )
            )}
            {ask.isPending && (
              <div className="flex items-center gap-2 text-[12.5px] text-fg-3" role="status">
                <span className="flex gap-1"><Dot /><Dot d={150} /><Dot d={300} /></span> Working out a plan…
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
                  <Mail className="size-3" /> {scoped ? "About this email" : "Whole inbox"}
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-line bg-surface-2 p-1.5 focus-within:border-[var(--ai-border)]">
              <label htmlFor="copilot-input" className="sr-only">Ask or instruct Copilot</label>
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
                placeholder={scoped ? "Try: draft a reply saying Thursday works" : "Try: archive all newsletters from last week"}
                className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] text-fg outline-none placeholder:text-fg-3"
              />
              {aiReady && <CopilotMic setInput={setInput} />}
              <button type="submit" disabled={!input.trim() || ask.isPending || !aiReady} aria-label="Send to Copilot" className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg disabled:opacity-40">
                <ArrowUp className="size-4" />
              </button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-3"><ShieldCheck className="size-3" /> Email content is untrusted and can’t add actions. Logged in Settings → Privacy.</p>
          </form>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

const ICONS: Record<CopilotActionType, ReactNode> = {
  search: <Search />, archive: <Archive />, unarchive: <Inbox />, star: <Star />, unstar: <StarOff />, mark_read: <MailOpen />, mark_unread: <Mail />,
  add_label: <Tag />, remove_label: <Tag />, create_label: <Tag />, trash: <Trash2 />, draft_reply: <FilePen />, draft_new: <FilePen />, send_reply: <Send />, send_new: <Send />,
};

type Phase = "review" | "confirm-risk" | "running" | "done" | "cancelled" | "expired" | "error";

function initialSelection(plan: PlanPreview): Record<number, Set<string>> {
  const s: Record<number, Set<string>> = {};
  for (const a of plan.actions) if (a.executable) s[a.index] = new Set(a.type === "create_label" ? ["label"] : [...a.threads.map((t) => t.key), ...a.drafts.map((d) => d.key)]);
  return s;
}

/** Preview of a plan with per-item checkboxes, Confirm/Cancel, progress and results with Undo. */
export function PlanCard({ plan, onOpenThread }: { plan: PlanPreview; onOpenThread?: (accountId: string, threadId: string) => void }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState(() => initialSelection(plan));
  const [phase, setPhase] = useState<Phase>(plan.planId ? "review" : "done");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [undone, setUndone] = useState<"idle" | "running" | "done">("idle");
  const [ack, setAck] = useState(false);

  const chosen = plan.actions.filter((a) => a.executable && (sel[a.index]?.size ?? 0) > 0);
  const trashCount = chosen.filter((a) => a.risk === "trash").reduce((n, a) => n + sel[a.index]!.size, 0);
  const sendCount = chosen.filter((a) => a.risk === "send").reduce((n, a) => n + sel[a.index]!.size, 0);
  const risky = trashCount > 0 || sendCount > 0;
  const total = chosen.reduce((n, a) => n + (a.type === "create_label" ? 1 : sel[a.index]!.size), 0);

  const refresh = () => {
    for (const k of ["threads", "thread", "labels", "drafts", "overview"]) void qc.invalidateQueries({ queryKey: [k] });
  };

  const execute = useMutation({
    mutationFn: () =>
      api.post<ExecuteResult>(`/copilot/plans/${plan.planId}/execute`, {
        selections: chosen.map((a) => ({ index: a.index, keys: a.type === "create_label" ? [] : [...sel[a.index]!] })),
        ...(trashCount ? { confirmTrash: true } : {}),
        ...(sendCount ? { confirmSend: true } : {}),
      }),
    onMutate: () => setPhase("running"),
    onSuccess: (r) => {
      setResult(r);
      setPhase("done");
      refresh();
    },
    onError: (e) => {
      setError(errorMessage(e));
      setPhase(e instanceof ApiError && (e.status === 410 || e.status === 409 || e.status === 404) ? "expired" : "error");
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/copilot/plans/${plan.planId}/cancel`),
    onSettled: () => setPhase("cancelled"),
  });
  const undo = useMutation({
    mutationFn: () => api.post<{ ok: number; failed: number }>(`/copilot/undo/${result!.undoId}`),
    onMutate: () => setUndone("running"),
    onSuccess: () => {
      setUndone("done");
      refresh();
    },
    onError: (e) => {
      setUndone("idle");
      setError(errorMessage(e));
    },
  });

  const toggle = (index: number, key: string, on: boolean) =>
    setSel((s) => {
      const next = new Set(s[index] ?? []);
      if (on) next.add(key);
      else next.delete(key);
      return { ...s, [index]: next };
    });
  const toggleAll = (a: PlanAction, on: boolean) =>
    setSel((s) => ({ ...s, [a.index]: new Set(on ? (a.type === "create_label" ? ["label"] : [...a.threads.map((t) => t.key), ...a.drafts.map((d) => d.key)]) : []) }));

  const locked = phase !== "review";
  const confirm = () => {
    if (risky) {
      setAck(false);
      setPhase("confirm-risk");
    } else execute.mutate();
  };

  return (
    <section aria-label="Copilot plan" data-testid="plan-card" className="rounded-2xl border border-[var(--ai-border)] bg-surface-2 p-3 animate-in">
      <div className="mb-2 flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-ink" />
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-fg">{plan.summary || "Here’s the plan"}</p>
          {plan.planId && phase === "review" && <p className="text-[11.5px] text-fg-3">Review and untick anything you don’t want. Nothing has changed yet.</p>}
        </div>
      </div>

      <ol className="space-y-2">
        {plan.actions.map((a) => (
          <ActionItem key={a.index} action={a} selected={sel[a.index] ?? new Set()} locked={locked || !a.executable} onToggle={toggle} onToggleAll={toggleAll} result={result?.results.find((r) => r.index === a.index)} onOpenThread={onOpenThread} />
        ))}
      </ol>

      {phase === "review" && plan.planId && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel</Button>
          <Button size="sm" variant={risky ? "danger" : "primary"} disabled={total === 0} onClick={confirm} icon={<Check className="size-3.5" />}>
            Confirm{total ? ` (${total})` : ""}
          </Button>
        </div>
      )}

      {phase === "confirm-risk" && (
        <div role="alertdialog" aria-label="Confirm risky actions" className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-[13px] text-fg">
          <p className="flex items-center gap-2 font-medium text-danger"><AlertTriangle className="size-4" /> Please confirm</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-fg-2">
            {trashCount > 0 && <li>Move <b>{trashCount}</b> conversation{trashCount === 1 ? "" : "s"} to Trash. (Gmail deletes Trash after 30 days; you can undo for 10 minutes.)</li>}
            {sendCount > 0 && <li>Send <b>{sendCount}</b> email{sendCount === 1 ? "" : "s"} exactly as shown above. Sent email can’t be unsent.</li>}
          </ul>
          <label className="mt-2 flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            {sendCount > 0 ? "I’ve read the email and want to send it" : "Yes, move them to Trash"}
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPhase("review")}>Back</Button>
            <Button size="sm" variant="danger" disabled={!ack} onClick={() => execute.mutate()} icon={sendCount ? <Send className="size-3.5" /> : <Trash2 className="size-3.5" />}>
              {sendCount > 0 ? `Send ${sendCount}` : `Move ${trashCount} to Trash`}
            </Button>
          </div>
        </div>
      )}

      {phase === "running" && (
        <p role="status" className="mt-3 flex items-center gap-2 text-[12.5px] text-fg-2"><Loader2 className="size-3.5 animate-spin" /> Working on it…</p>
      )}

      {phase === "done" && result && (
        <div role="status" data-testid="plan-result" className="mt-3 rounded-xl border border-line bg-surface p-3 text-[13px]">
          <p className="font-medium text-fg">{summarize(result.results)}</p>
          {result.results.some((r) => r.error) && <p className="mt-1 text-[12px] text-danger">{result.results.find((r) => r.error)?.error}</p>}
          {result.undoId && (
            <div className="mt-2 flex items-center gap-2">
              {undone === "done" ? (
                <span className="text-[12.5px] text-fg-2">Undone.</span>
              ) : (
                <Button size="sm" variant="secondary" loading={undone === "running"} icon={<Undo2 className="size-3.5" />} onClick={() => undo.mutate()}>
                  Undo
                </Button>
              )}
              {undone !== "done" && <span className="text-[11.5px] text-fg-3">Available for 10 minutes</span>}
            </div>
          )}
        </div>
      )}
      {phase === "cancelled" && <p className="mt-3 text-[12.5px] text-fg-3">Cancelled. Nothing was changed.</p>}
      {(phase === "expired" || phase === "error") && <p role="alert" className="mt-3 text-[12.5px] text-danger">{error ?? "Something went wrong."}</p>}
      {error && phase === "done" && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}

function summarize(results: ActionResult[]): string {
  const ok = results.reduce((n, r) => n + r.ok, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  if (!failed) return `Done: ${results.map((r) => doneText(r)).join(" · ")}`;
  return `${ok} done, ${failed} failed.`;
}

function doneText(r: ActionResult): string {
  const n = r.ok;
  const c = `${n} conversation${n === 1 ? "" : "s"}`;
  switch (r.type) {
    case "archive": return `archived ${c}`;
    case "unarchive": return `moved ${c} to Inbox`;
    case "star": return `starred ${c}`;
    case "unstar": return `unstarred ${c}`;
    case "mark_read": return `marked ${c} read`;
    case "mark_unread": return `marked ${c} unread`;
    case "add_label": return `labelled ${c}`;
    case "remove_label": return `removed a label from ${c}`;
    case "create_label": return "created the label";
    case "trash": return `moved ${c} to Trash`;
    case "draft_reply": case "draft_new": return `saved ${n} draft${n === 1 ? "" : "s"} in Gmail`;
    case "send_reply": case "send_new": return `sent ${n} email${n === 1 ? "" : "s"}`;
    default: return r.title;
  }
}

function ActionItem({ action: a, selected, locked, onToggle, onToggleAll, result, onOpenThread }: {
  action: PlanAction;
  selected: Set<string>;
  locked: boolean;
  onToggle: (index: number, key: string, on: boolean) => void;
  onToggleAll: (a: PlanAction, on: boolean) => void;
  result?: ActionResult;
  onOpenThread?: (accountId: string, threadId: string) => void;
}) {
  const [expanded, setExpanded] = useState(a.threads.length <= 5 || a.drafts.length > 0);
  const items = a.drafts.length ? a.drafts.length : a.threads.length;
  const allOn = a.type === "create_label" ? selected.size > 0 : items > 0 && selected.size === items;
  const someOn = selected.size > 0 && !allOn;
  const visibleThreads = expanded ? a.threads : a.threads.slice(0, 5);

  return (
    <li className={cn("rounded-xl border bg-surface p-2.5", a.risk === "trash" || a.risk === "send" ? "border-danger/40" : "border-line")}>
      <div className="flex items-start gap-2">
        {a.executable && a.type !== "search" ? (
          <input
            type="checkbox"
            aria-label={`Include: ${a.title}`}
            checked={allOn}
            ref={(el) => {
              if (el) el.indeterminate = someOn;
            }}
            disabled={locked}
            onChange={(e) => onToggleAll(a, e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          />
        ) : (
          <span className="mt-0.5 size-4 shrink-0" />
        )}
        <span className={cn("mt-0.5 shrink-0 [&>svg]:size-4", a.risk === "trash" || a.risk === "send" ? "text-danger" : "text-accent-ink")}>{ICONS[a.type]}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-fg">{a.title}</p>
          {a.query && <p className="truncate font-mono text-[11px] text-fg-3" title={a.query}>{a.query}</p>}
          {a.note && <p className="mt-0.5 text-[11.5px] text-fg-3">{a.note}</p>}
          {result && (
            <p className={cn("mt-1 text-[11.5px]", result.failed ? "text-danger" : "text-success")}>
              {result.failed ? `${result.ok} done, ${result.failed} failed` : `✓ ${doneText(result)}`}
            </p>
          )}
        </div>
      </div>

      {a.drafts.length > 0 ? (
        <div className="mt-2 space-y-2 pl-6">
          {a.drafts.map((d) => (
            <label key={d.key} className="block rounded-lg border border-line bg-surface-2 p-2.5 text-[12.5px]">
              <span className="flex items-start gap-2">
                <input type="checkbox" checked={selected.has(d.key)} disabled={locked} onChange={(e) => onToggle(a.index, d.key, e.target.checked)} aria-label={`Include email to ${d.to.join(", ")}`} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-fg-3"><span className="text-fg-2">To:</span> {d.to.join(", ") || "(no recipient yet: add one in Drafts)"}</span>
                  <span className="block text-fg-3"><span className="text-fg-2">From:</span> {d.from}</span>
                  <span className="block font-medium text-fg">{d.subject || "(no subject)"}</span>
                  <span className="mt-1.5 block whitespace-pre-wrap border-t border-line pt-1.5 text-fg-2" data-testid="draft-body">{d.body}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : a.threads.length > 0 ? (
        <ul className="mt-2 space-y-1 pl-6">
          {visibleThreads.map((t) => (
            <li key={t.key} className="flex items-center gap-2 text-[12.5px]">
              {a.type !== "search" && (
                <input type="checkbox" checked={selected.has(t.key)} disabled={locked} onChange={(e) => onToggle(a.index, t.key, e.target.checked)} aria-label={`Include ${t.subject}`} className="size-3.5 shrink-0 accent-[var(--accent)]" />
              )}
              <button type="button" onClick={() => onOpenThread?.(t.accountId, t.threadId)} className="min-w-0 flex-1 truncate text-left hover:underline">
                <span className="font-medium text-fg">{t.from}</span> <span className="text-fg-2">· {t.subject}</span>
              </button>
              <span className="shrink-0 text-[11px] text-fg-3">{t.date ? listDate(t.date) : ""}</span>
            </li>
          ))}
          {a.threads.length > 5 && (
            <li>
              <button type="button" onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline">
                <ChevronDown className={cn("size-3", expanded && "rotate-180")} /> {expanded ? "Show fewer" : `Show all ${a.threads.length}`}
              </button>
            </li>
          )}
        </ul>
      ) : null}
    </li>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return <span className="size-1.5 animate-bounce rounded-full bg-accent-400" style={{ animationDelay: `${d}ms` }} />;
}
