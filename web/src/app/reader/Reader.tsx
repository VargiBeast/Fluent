import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Archive, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, CornerUpLeft, Download, FileText, Forward, Image as ImageIcon,
  Inbox, Mail, MailOpen, Maximize2, MoreHorizontal, Paperclip, Reply, ReplyAll, Send, ShieldAlert, Sparkles, Star, Tag, Trash2, Undo2, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { MessageDetail, ThreadAction, ThreadDetail } from "@shared/mail";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { SnoozeBanner, SnoozeMenu } from "./SnoozeMenu";
import { sendWithUndo } from "@/lib/undoSend";
import { Menu, MenuCheckbox, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/Menu";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { displayName, formatBytes, fullDate, relative } from "@/lib/format";
import { attachmentUrl, useLabelMutation, useLabels, useThread, useThreadAction } from "@/lib/mail";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fmtAddr, quoteHtml, replyRecipients, replySubject, textToParagraphs, type SendPayload } from "@/lib/compose";
import { useComposer } from "../composer/context";
import { EmailBody } from "./EmailBody";
import { AiSummary, useInsights } from "./AiSummary";

export interface ReaderProps {
  accountId?: string;
  threadId?: string;
  position?: { index: number; total: number; prev?: () => void; next?: () => void };
  onClose: () => void;
  onOpenCopilot: () => void;
  folder: string;
}

export function Reader({ accountId, threadId, position, onClose, onOpenCopilot, folder }: ReaderProps) {
  const thread = useThread(accountId, threadId);
  if (!accountId || !threadId) {
    return (
      <EmptyState
        icon={<Mail className="size-5" />}
        title="Select a conversation"
        description={<>Pick an email from the list to read it here. Press <kbd className="rounded border border-line px-1">j</kbd>/<kbd className="rounded border border-line px-1">k</kbd> to move, <kbd className="rounded border border-line px-1">c</kbd> to compose.</>}
      />
    );
  }
  if (thread.isLoading) return <ReaderSkeleton onClose={onClose} />;
  if (thread.isError || !thread.data) {
    const notFound = thread.error instanceof ApiError && thread.error.status === 404;
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center border-b border-line px-3 lg:hidden"><IconButton label="Back" onClick={onClose}><ArrowLeft className="size-5" /></IconButton></div>
        <EmptyState
          icon={<AlertTriangle className="size-5" />}
          title={notFound ? "This conversation is gone" : "Couldn't open this conversation"}
          description={notFound ? "It may have been deleted or moved in Gmail." : errorMessage(thread.error)}
          action={notFound ? <Button onClick={onClose}>Back to list</Button> : <Button onClick={() => void thread.refetch()}>Try again</Button>}
        />
      </div>
    );
  }
  return <ReaderBody key={`${accountId}:${threadId}`} thread={thread.data} position={position} onClose={onClose} onOpenCopilot={onOpenCopilot} folder={folder} />;
}

function ReaderBody({ thread, position, onClose, onOpenCopilot, folder }: { thread: ThreadDetail } & Omit<ReaderProps, "accountId" | "threadId">) {
  const { session, config } = useSession();
  const action = useThreadAction();
  const composer = useComposer();
  const [confirmTrash, setConfirmTrash] = useState(false);
  const aiOn = Boolean(config?.ai) && session?.settings?.ai.enabled !== false;
  const [summaryRequested, setSummaryRequested] = useState(false);
  const autoSummarize = aiOn && (session?.settings?.ai.autoSummarize ?? true);
  const insights = useInsights(thread, aiOn && (autoSummarize || summaryRequested));
  const real = thread.messages.filter((m) => !m.isDraft);
  const last = real[real.length - 1] ?? thread.messages[thread.messages.length - 1]!;

  // Opening a conversation marks it read in Gmail.
  useEffect(() => {
    if (thread.unread) action.mutate({ accountId: thread.accountId, threadId: thread.id, action: "read", folder: folder as never });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  const run = (a: ThreadAction, msg?: string, leave = false) => {
    action.mutate({ accountId: thread.accountId, threadId: thread.id, action: a, folder: folder as never }, {
      onSuccess: () => {
        if (msg) {
          toast.success(msg, a === "archive" || a === "trash" ? {
            action: { label: "Undo", onClick: () => action.mutate({ accountId: thread.accountId, threadId: thread.id, action: a === "archive" ? "inbox" : "untrash" }) },
          } : undefined);
        }
      },
    });
    if (leave) {
      if (position?.next) position.next();
      else onClose();
    }
  };

  useReaderShortcuts({
    e: () => run("archive", "Conversation archived", true),
    "#": () => setConfirmTrash(true),
    s: () => run(thread.starred ? "unstar" : "star"),
    u: () => run("unread", "Marked as unread", true),
    z: () => document.querySelector<HTMLButtonElement>("[data-snooze-trigger]")?.click(),
    r: () => composer.open({ mode: "reply", thread, message: last }),
    a: () => composer.open({ mode: "replyAll", thread, message: last }),
    f: () => composer.open({ mode: "forward", thread, message: last }),
    Escape: onClose,
  });

  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={`Conversation: ${thread.subject}`}>
      <div className="flex h-14 shrink-0 items-center gap-0.5 border-b border-line px-2 sm:px-3">
        <IconButton label="Back to list" onClick={onClose}><ArrowLeft className="size-[18px]" /></IconButton>
        <div className="mx-1 h-5 w-px bg-line" aria-hidden />
        {thread.inTrash ? (
          <IconButton label="Restore from Trash" onClick={() => run("untrash", "Restored from Trash")}><Undo2 className="size-[18px]" /></IconButton>
        ) : thread.inInbox ? (
          <IconButton label="Archive (e)" onClick={() => run("archive", "Conversation archived", true)}><Archive className="size-[18px]" /></IconButton>
        ) : (
          <IconButton label="Move to Inbox" onClick={() => run("inbox", "Moved to Inbox")}><Inbox className="size-[18px]" /></IconButton>
        )}
        <IconButton label={folder === "spam" ? "Not spam" : "Report spam"} onClick={() => run(folder === "spam" ? "notspam" : "spam", folder === "spam" ? "Moved to Inbox" : "Reported as spam", true)}>
          <ShieldAlert className="size-[18px]" />
        </IconButton>
        {!thread.inTrash && (
          <IconButton label="Delete (#)" onClick={() => setConfirmTrash(true)}><Trash2 className="size-[18px]" /></IconButton>
        )}
        <IconButton label="Mark as unread (u)" onClick={() => run("unread", "Marked as unread", true)}><MailOpen className="size-[18px]" /></IconButton>
        {!thread.inTrash && <SnoozeMenu thread={thread} onSnoozed={() => (position?.next ? position.next() : onClose())} />}
        <div className="mx-1 h-5 w-px bg-line" aria-hidden />
        <IconButton label={thread.starred ? "Unstar (s)" : "Star (s)"} active={thread.starred} onClick={() => run(thread.starred ? "unstar" : "star")}>
          <Star className={cn("size-[18px]", thread.starred && "text-amber-400")} fill={thread.starred ? "currentColor" : "none"} />
        </IconButton>
        <LabelsMenu thread={thread} />
        <Menu>
          <MenuTrigger asChild><IconButton label="More actions"><MoreHorizontal className="size-[18px]" /></IconButton></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Reply />} onSelect={() => composer.open({ mode: "reply", thread, message: last })}>Reply</MenuItem>
            <MenuItem icon={<ReplyAll />} onSelect={() => composer.open({ mode: "replyAll", thread, message: last })}>Reply all</MenuItem>
            <MenuItem icon={<Forward />} onSelect={() => composer.open({ mode: "forward", thread, message: last })}>Forward</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Tag />} onSelect={() => run(thread.important ? "unimportant" : "important", thread.important ? "Marked not important" : "Marked important")}>
              {thread.important ? "Mark not important" : "Mark important"}
            </MenuItem>
            {aiOn && <MenuItem icon={<Sparkles />} onSelect={onOpenCopilot}>Ask Copilot about this</MenuItem>}
          </MenuContent>
        </Menu>
        <div className="flex-1" />
        {position && position.total > 0 && (
          <div className="hidden items-center gap-1 text-[12px] text-fg-3 sm:flex">
            <span aria-live="polite">{position.index + 1} of {position.total}</span>
            <IconButton label="Previous conversation (k)" size="sm" disabled={!position.prev} onClick={position.prev}><ChevronLeft className="size-4" /></IconButton>
            <IconButton label="Next conversation (j)" size="sm" disabled={!position.next} onClick={position.next}><ChevronRight className="size-4" /></IconButton>
          </div>
        )}
        {aiOn && (
          <Button size="sm" variant="ai" className="ml-1" icon={<Sparkles className="size-3.5" />} onClick={onOpenCopilot}>
            <span className="hidden sm:inline">Copilot</span>
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <SnoozeBanner thread={thread} />
        <div className="mx-auto max-w-[860px] space-y-5 px-4 pb-8 pt-5 sm:px-8">
          <div className="flex items-start gap-3">
            <span className={cn("mt-2 size-2.5 shrink-0 rounded-full", thread.important ? "bg-accent" : "bg-surface-3")} aria-hidden />
            <h1 className="text-[20px] font-semibold leading-snug text-fg">{thread.subject}</h1>
          </div>
          {thread.labelIds.some((l) => l.startsWith("Label_")) && <ThreadLabels thread={thread} />}

          <AiSummary thread={thread} insights={insights} autoEnabled={autoSummarize} onRequest={() => setSummaryRequested(true)} />

          <div className="space-y-3">
            {thread.messages.map((m, i) => (
              <MessageCard key={m.id} m={m} thread={thread} defaultOpen={i === thread.messages.length - 1 || m.unread || thread.messages.length <= 2} />
            ))}
          </div>

          {!thread.inTrash && (
            <QuickReply thread={thread} message={last} suggestions={insights.data?.quickReplies ?? []} aiOn={aiOn} />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmTrash}
        onOpenChange={setConfirmTrash}
        title="Move this conversation to Trash?"
        description="It will be moved to Trash in Gmail. You can restore it from Trash for 30 days; after that Gmail deletes it permanently."
        confirmLabel="Move to Trash"
        danger
        onConfirm={() => { setConfirmTrash(false); run("trash", "Moved to Trash", true); }}
      />
    </article>
  );
}

function useReaderShortcuts(map: Record<string, () => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[role=dialog]")) return;
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

function ThreadLabels({ thread }: { thread: ThreadDetail }) {
  const labels = useLabels(thread.accountId);
  const mut = useLabelMutation();
  const defs = labels.data?.accounts.find((a) => a.accountId === thread.accountId)?.labels ?? [];
  const applied = defs.filter((l) => thread.labelIds.includes(l.id));
  if (!applied.length) return null;
  return (
    <div className="-mt-2 flex flex-wrap gap-1.5 pl-5">
      {applied.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[11.5px] text-fg-2">
          <span className="size-1.5 rounded-sm" style={{ background: l.color?.backgroundColor ?? "var(--accent)" }} aria-hidden />
          {l.name}
          <button type="button" aria-label={`Remove label ${l.name}`} className="ml-0.5 text-fg-3 hover:text-fg" onClick={() => mut.mutate({ accountId: thread.accountId, threadId: thread.id, remove: [l.id] })}>×</button>
        </span>
      ))}
    </div>
  );
}

function LabelsMenu({ thread }: { thread: ThreadDetail }) {
  const labels = useLabels(thread.accountId);
  const mut = useLabelMutation();
  const qc = useQueryClient();
  const defs = labels.data?.accounts.find((a) => a.accountId === thread.accountId)?.labels ?? [];
  return (
    <Menu>
      <MenuTrigger asChild><IconButton label="Labels"><Tag className="size-[18px]" /></IconButton></MenuTrigger>
      <MenuContent className="max-h-[60vh] overflow-y-auto">
        <MenuLabel>Label as</MenuLabel>
        {defs.length === 0 && <div className="px-2.5 py-2 text-[12.5px] text-fg-3">No labels yet. Create one from the sidebar.</div>}
        {defs.map((l) => {
          const on = thread.labelIds.includes(l.id);
          return (
            <MenuCheckbox
              key={l.id}
              checked={on}
              onCheckedChange={(v) => {
                qc.setQueryData<ThreadDetail>(["thread", thread.accountId, thread.id], (t) => t ? { ...t, labelIds: v ? [...t.labelIds, l.id] : t.labelIds.filter((x) => x !== l.id) } : t);
                mut.mutate({ accountId: thread.accountId, threadId: thread.id, add: v ? [l.id] : [], remove: v ? [] : [l.id] });
              }}
            >
              {l.name}
            </MenuCheckbox>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

function MessageCard({ m, thread, defaultOpen }: { m: MessageDetail; thread: ThreadDetail; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [details, setDetails] = useState(false);
  const composer = useComposer();
  const me = thread.accountEmail;
  const toLine = m.to.map((a) => (a.email === me ? "me" : displayName(a))).join(", ") || "undisclosed recipients";
  const files = m.attachments.filter((a) => !a.inline || !m.bodyHtml?.includes(`cid:${a.contentId}`));
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2" aria-expanded={false}>
        <Avatar name={displayName(m.from)} email={m.from.email} size={30} />
        <span className="w-32 shrink-0 truncate text-[13px] font-medium text-fg-2 sm:w-40">{m.isFromMe ? "You" : displayName(m.from)}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg-3">{m.isDraft ? <span className="text-danger">Draft · </span> : null}{m.snippet}</span>
        <time className="shrink-0 text-[12px] text-fg-3" dateTime={m.date}>{relative(m.date)}</time>
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Avatar name={displayName(m.from)} email={m.from.email} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[14px] font-semibold text-fg">{m.isFromMe ? `${displayName(m.from)} (you)` : displayName(m.from)}</span>
            {m.isDraft && <span className="text-[12px] font-medium text-danger">Draft</span>}
          </div>
          <button type="button" onClick={() => setDetails((v) => !v)} className="mt-0.5 flex max-w-full items-center gap-1 text-left text-[12.5px] text-fg-3 hover:text-fg-2" aria-expanded={details}>
            <span className="truncate">{m.from.email} → to: {toLine}{m.cc.length ? `, cc: ${m.cc.map(displayName).join(", ")}` : ""}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", details && "rotate-180")} aria-hidden />
          </button>
          {details && (
            <dl className="mt-2 grid grid-cols-[60px_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface-2 p-3 text-[12.5px]">
              <dt className="text-fg-3">From</dt><dd className="break-all text-fg-2">{fmtAddr(m.from)}</dd>
              <dt className="text-fg-3">To</dt><dd className="break-all text-fg-2">{m.to.map(fmtAddr).join(", ") || "—"}</dd>
              {m.cc.length > 0 && <><dt className="text-fg-3">Cc</dt><dd className="break-all text-fg-2">{m.cc.map(fmtAddr).join(", ")}</dd></>}
              {m.bcc.length > 0 && <><dt className="text-fg-3">Bcc</dt><dd className="break-all text-fg-2">{m.bcc.map(fmtAddr).join(", ")}</dd></>}
              {m.replyTo.length > 0 && <><dt className="text-fg-3">Reply-to</dt><dd className="break-all text-fg-2">{m.replyTo.map(fmtAddr).join(", ")}</dd></>}
              <dt className="text-fg-3">Date</dt><dd className="text-fg-2">{fullDate(m.date)}</dd>
              <dt className="text-fg-3">Account</dt><dd className="break-all text-fg-2">{thread.accountEmail}</dd>
            </dl>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <time className="mr-1 hidden text-[12px] text-fg-3 md:inline" dateTime={m.date}>{fullDate(m.date)} ({relative(m.date)})</time>
          <IconButton label="Reply" size="sm" onClick={() => composer.open({ mode: "reply", thread, message: m })}><CornerUpLeft className="size-4" /></IconButton>
          <Menu>
            <MenuTrigger asChild><IconButton label="Message actions" size="sm"><MoreHorizontal className="size-4" /></IconButton></MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Reply />} onSelect={() => composer.open({ mode: "reply", thread, message: m })}>Reply</MenuItem>
              <MenuItem icon={<ReplyAll />} onSelect={() => composer.open({ mode: "replyAll", thread, message: m })}>Reply all</MenuItem>
              <MenuItem icon={<Forward />} onSelect={() => composer.open({ mode: "forward", thread, message: m })}>Forward</MenuItem>
            </MenuContent>
          </Menu>
          {thread.messages.length > 1 && (
            <IconButton label="Collapse message" size="sm" onClick={() => setOpen(false)}><ChevronDown className="size-4 rotate-180" /></IconButton>
          )}
        </div>
      </div>
      <time className="mt-2 block text-[12px] text-fg-3 md:hidden" dateTime={m.date}>{fullDate(m.date)}</time>
      <div className="mt-4 sm:pl-[50px]">
        <EmailBody message={m} accountId={thread.accountId} />
        {files.length > 0 && <AttachmentList accountId={thread.accountId} files={files} />}
      </div>
    </div>
  );
}

function AttachmentList({ accountId, files }: { accountId: string; files: MessageDetail["attachments"] }) {
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-fg-3"><Paperclip className="size-3.5" aria-hidden />{files.length} attachment{files.length > 1 ? "s" : ""}</p>
      <ul className="flex flex-wrap gap-2">
        {files.map((a) => (
          <li key={a.attachmentId + a.filename}>
            <a
              href={attachmentUrl(accountId, a.messageId, a.attachmentId, a.filename)}
              download={a.filename}
              className="group flex w-56 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2 hover:border-line-strong"
              aria-label={`Download ${a.filename} (${formatBytes(a.size)})`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-400">
                {a.mimeType.startsWith("image/") ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-fg">{a.filename}</span>
                <span className="block text-[11.5px] text-fg-3">{formatBytes(a.size)}</span>
              </span>
              <Download className="size-4 text-fg-3 group-hover:text-fg" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuickReply({ thread, message, suggestions, aiOn }: { thread: ThreadDetail; message: MessageDetail; suggestions: string[]; aiOn: boolean }) {
  const { session } = useSession();
  const composer = useComposer();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [aiText, setAiText] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rec = useMemo(() => replyRecipients(thread, message, false), [thread, message]);
  const isAi = aiText !== null;

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api.post<{ body: string }>("/ai/draft", { accountId: thread.accountId, threadId: thread.id, mode: "reply", instruction: text.trim() || undefined });
      setText(r.body);
      setAiText(r.body);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  const send = async (aiConfirmed: boolean) => {
    if (!text.trim()) return;
    if (isAi && !aiConfirmed) {
      setConfirm(true);
      return;
    }
    setSending(true);
    const sig = session?.settings?.ai.signature;
    const body = textToParagraphs(text.trim()) + (sig ? `<p>${sig.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>` : "");
    const payload: SendPayload = {
      accountId: thread.accountId,
      to: rec.to,
      cc: [],
      bcc: [],
      subject: replySubject(message.subject || thread.subject),
      html: body + quoteHtml(message),
      text: text.trim(),
      threadId: thread.id,
      inReplyTo: message.messageIdHeader || undefined,
      references: [message.references, message.messageIdHeader].filter(Boolean).join(" ") || undefined,
      attachments: [],
      aiGenerated: isAi,
      aiConfirmed,
    };
    const draft = { text, aiText };
    setConfirm(false);
    setText("");
    setAiText(null);
    sendWithUndo({
      seconds: Number(session?.settings?.compose?.undoSendSeconds ?? "5"),
      label: "Sending reply…",
      onUndo: () => {
        setText(draft.text);
        setAiText(draft.aiText);
        setSending(false);
        toast("Sending cancelled", { description: "Your reply is back in the box." });
      },
      run: async () => {
        try {
          await api.post("/compose/send", payload);
          toast.success("Reply sent");
          await qc.invalidateQueries({ queryKey: ["thread", thread.accountId, thread.id] });
          void qc.invalidateQueries({ queryKey: ["threads"] });
        } catch (err) {
          setText(draft.text);
          setAiText(draft.aiText);
          toast.error(errorMessage(err));
        } finally {
          setSending(false);
        }
      },
    });
  };

  return (
    <div className="space-y-3 pt-2">
      {aiOn && suggestions.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] text-fg-3">Quick answers</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 3).map((s) => (
              <button key={s} type="button" onClick={() => { setText(s); setAiText(s); }} className="rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-[12.5px] text-fg-2 hover:border-[var(--ai-border)] hover:text-fg">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-3">
        <div className="hidden sm:block"><Avatar name={session?.user?.name ?? "Me"} email={session?.user?.email} src={session?.user?.picture} size={32} /></div>
        <form
          className="min-w-0 flex-1 rounded-2xl border border-line bg-surface-2 focus-within:border-line-strong"
          onSubmit={(e) => { e.preventDefault(); void send(false); }}
          aria-label="Quick reply"
        >
          <div className="flex items-center justify-between gap-2 px-4 pt-3 text-[12.5px]">
            <span className="min-w-0 truncate text-fg-3">Recipient <span className="text-fg-2">{rec.to.join(", ")}</span></span>
            {aiOn && (
              <button type="button" onClick={() => void generate()} disabled={generating} className="flex shrink-0 items-center gap-1.5 font-medium text-ai-title hover:brightness-125 disabled:opacity-50">
                <Wand2 className={cn("size-3.5", generating && "animate-pulse")} aria-hidden />
                {generating ? "Writing…" : "Generate quick reply"}
              </button>
            )}
          </div>
          <label htmlFor={`qr-${thread.id}`} className="sr-only">Reply text</label>
          <textarea
            id={`qr-${thread.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(false); } }}
            rows={text.split("\n").length > 3 ? 6 : 2}
            placeholder={aiOn ? "Write a reply… or type an instruction and press Generate" : "Write a reply…"}
            className="block w-full resize-none bg-transparent px-4 py-2 text-[13.5px] text-fg placeholder:text-fg-3 outline-none"
          />
          {isAi && <p className="px-4 text-[11.5px] text-ai-title">✦ Written with AI — review before sending.</p>}
          <div className="flex items-center gap-1 px-2 pb-2">
            <IconButton
              label="Open full composer (attachments, formatting, CC/BCC)"
              size="sm"
              onClick={() => { composer.open({ mode: "reply", thread, message, bodyText: text, aiGenerated: isAi }); setText(""); setAiText(null); }}
            >
              <Maximize2 className="size-4" />
            </IconButton>
            <IconButton label="Attach files" size="sm" onClick={() => { composer.open({ mode: "reply", thread, message, bodyText: text, aiGenerated: isAi }); setText(""); setAiText(null); }}>
              <Paperclip className="size-4" />
            </IconButton>
            <div className="flex-1" />
            <span className="hidden text-[11px] text-fg-3 sm:inline">⌘/Ctrl + Enter</span>
            <button
              type="submit"
              aria-label="Send reply"
              disabled={!text.trim() || sending}
              className="ml-2 flex size-8 items-center justify-center rounded-full bg-accent text-white transition hover:brightness-110 disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Send AI-written reply?"
        description="FLUENT never sends AI-generated text on its own. Please confirm you've reviewed this reply."
        confirmLabel="Send reply"
        loading={sending}
        onConfirm={() => void send(true)}
      >
        <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[13px] text-fg-2">{text}</div>
      </ConfirmDialog>
    </div>
  );
}

function ReaderSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading conversation">
      <div className="flex h-14 items-center gap-2 border-b border-line px-3">
        <IconButton label="Back to list" onClick={onClose}><ArrowLeft className="size-[18px]" /></IconButton>
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="mx-auto w-full max-w-[860px] space-y-5 px-8 pt-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}
