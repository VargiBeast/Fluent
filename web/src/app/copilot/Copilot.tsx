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

type Prefill = { text: string; autoSend: boolean; n: number; mode?: "ask" };

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
  const context = m?.params.accountId && m.params.threadId && m.params.folder !== "settings"
    ? { accountId: m.params.accountId, threadId: m.params.threadId }
    : undefined;
  return <CopilotPanel open={isOpen} onOpenChange={setOpen} context={context} prefill={prefill} />;
}

export function CopilotPanel({ open, onOpenChange, context, prefill }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context?: { accountId: string; threadId: string };
  prefill?: Prefill;
}) {
  const { config } = useSession();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [useThread, setUseThread] = useState(true);
  const [expanded, setExpanded] = useState(() => localStorage.getItem("mailiq.copilot.expanded") === "1");
  useEffect(() => localStorage.setItem("mailiq.copilot.expanded", expanded ? "1" : "0"), [expanded]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scoped = Boolean(context && useThread);
  const aiReady = Boolean(config?.ai);

  useEffect(() => {
    if (!open || !prefill?.text) return;
    if (prefill.autoSend) {
      void send(prefill.text);
    } else {
      setInput(prefill.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.n]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const push = (m: NewMsg) => setMessages((xs) => [...xs, { ...m, id: nextId++ } as Msg]);

  const ask = useMutation({
    mutationFn: async (text: string) => {
      const body: Record<string, unknown> = { message: text };
      if (scoped && context) {
        body.accountId = context.accountId;
        body.threadId = context.threadId;
      }
      return api.post<CopilotReply>("/copilot/ask", body);
    },
    onSuccess: (res) => {
      if (res.kind === "plan") push({ role: "plan", plan: res.plan });
      else if (res.kind === "answer") push({ role: "assistant", text: res.text, citations: res.citations });
      else push({ role: "assistant", text: (res as { text?: string }).text ?? "Done." });
    },
    onError: (err) => push({ role: "error", text: errorMessage(err) }),
  });

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || ask.isPending || !aiReady) return;
    setInput("");
    push({ role: "user", text });
    ask.mutate(text);
  }

  const prompts = scoped ? THREAD_PROMPTS : INBOX_PROMPTS;

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in" />
        <RD.Content
          className={cn(
            "fixed z-50 flex flex-col border border-line bg-surface shadow-2xl outline-none",
            expanded
              ? "inset-4 max-h-[calc(100%-2rem)] rounded-2xl sm:inset-x-[12%] sm:inset-y-8"
              : "bottom-0 right-0 top-0 w-full max-w-md border-l sm:rounded-l-2xl",
          )}
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Sparkles className="size-4 text-accent-ink" />
            <RD.Title className="text-[14.5px] font-semibold text-fg">MailIQ Copilot</RD.Title>
            <span className="hidden text-[11px] text-fg-3 sm:inline" title="Toggle Copilot"><Kbd>⌘J</Kbd></span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className="hidden rounded-md p-1.5 text-fg-3 hover:bg-surface-2 sm:inline-flex"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? "Dock to the side" : "Expand Copilot"}
              >
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              <RD.Close className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2" aria-label="Close">
                <X className="size-4" />
              </RD.Close>
            </div>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scroll-thin">
            {!aiReady && (
              <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-[13px] text-fg-3">
                AI isn’t configured on this server. Add an AI provider key (see docs/SETUP.md) to use Copilot.
              </p>
            )}
            {aiReady && messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-[13px] text-fg-3">Ask MailIQ Copilot about your inbox or give it an instruction.</p>
                <div className="flex flex-wrap gap-2">
                  {prompts.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-left text-[12.5px] text-fg-2 hover:border-accent hover:text-fg"
                      onClick={() => void send(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("rounded-xl px-3 py-2 text-[13.5px]", m.role === "user" ? "ml-8 bg-accent text-accent-fg" : m.role === "error" ? "border border-danger/40 bg-danger/10 text-fg" : "mr-4 border border-line bg-surface-2 text-fg")}>
                {m.role === "plan" ? (
                  <PlanCard plan={m.plan} onOpenThread={(accountId, threadId) => navigate(`/app/inbox/${accountId}/${threadId}`)} />
                ) : (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                )}
                {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-line/60 pt-2">
                    {m.citations.slice(0, 6).map((t) => (
                      <li key={`${t.accountId}:${t.id}`}>
                        <button type="button" className="text-left text-[12px] text-accent-ink hover:underline" onClick={() => navigate(`/app/inbox/${t.accountId}/${t.id}`)}>
                          {t.subject || "(no subject)"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {ask.isPending && (
              <div className="mr-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[13px] text-fg-3">
                <Loader2 className="size-4 animate-spin" /> Thinking…
              </div>
            )}
          </div>

          {context && (
            <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-[12px] text-fg-3">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={useThread} onChange={(e) => setUseThread(e.target.checked)} />
                Use current conversation as context
              </label>
            </div>
          )}

          <form
            className="border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-line bg-surface-2 px-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                disabled={!aiReady}
                maxLength={1000}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={scoped ? "Try: draft a reply saying Thursday works" : "Try: archive all newsletters from last week"}
                className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] text-fg outline-none placeholder:text-fg-3"
              />
              <button type="submit" disabled={!input.trim() || ask.isPending || !aiReady} aria-label="Send to Copilot" className="mb-1.5 flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg disabled:opacity-40">
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

/** Plan preview card used by Copilot and Overview. */
export function PlanCard({ plan, onOpenThread }: { plan: PlanPreview; onOpenThread?: (accountId: string, threadId: string) => void }) {
  return (
    <div className="space-y-3 p-1">
      <p className="text-[13.5px] text-fg">{plan.summary}</p>
      <ul className="space-y-2">
        {plan.actions.map((a) => (
          <li key={a.index} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            <p className="text-[13px] font-medium text-fg">{a.title}</p>
            {a.note && <p className="mt-0.5 text-[12px] text-fg-3">{a.note}</p>}
            {a.threads.length > 0 && (
              <p className="mt-1 text-[11.5px] text-fg-3">
                {a.threads.length} conversation{a.threads.length === 1 ? "" : "s"}
                {onOpenThread && a.threads[0] && (
                  <>
                    {" · "}
                    <button type="button" className="text-accent-ink hover:underline" onClick={() => onOpenThread(a.threads[0]!.accountId, a.threads[0]!.threadId)}>
                      Open
                    </button>
                  </>
                )}
              </p>
            )}
            {a.drafts.length > 0 && (
              <p className="mt-1 text-[11.5px] text-fg-3">{a.drafts.length} draft{a.drafts.length === 1 ? "" : "s"}</p>
            )}
          </li>
        ))}
      </ul>
      {!plan.planId && (
        <p className="text-[12px] text-fg-3">This is a preview. Confirm to continue.</p>
      )}
    </div>
  );
}
