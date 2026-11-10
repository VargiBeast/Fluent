import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bold, Italic, Underline, List, ListOrdered, Quote, Link2, Paperclip, Sparkles, Maximize2, Minimize2, X, Trash2, Send, Loader2, FileText, Wand2, ChevronDown, Undo2, FileStack,
} from "lucide-react";
import type { ThreadDetail } from "@shared/mail";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/Menu";
import { Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { sendWithUndo } from "@/lib/undoSend";
import { formatBytes } from "@/lib/format";
import {
  EMAIL_RE, fileToBase64, fmtAddr, forwardHtml, forwardSubject, htmlToPlain, quoteHtml, replyRecipients, replySubject, textToParagraphs,
  type OutgoingAttachment, type SendPayload,
} from "@/lib/compose";
import { useComposer, type ComposeRequest } from "./context";
import { RecipientInput } from "./RecipientInput";
import { TemplateEditorDialog, TemplatePicker } from "./TemplatePicker";
import { isTemplateShortcut, TEMPLATE_SHORTCUT_LABEL, templateToHtml } from "@/lib/templates";
import type { Template } from "@shared/templates";
import { MicButton } from "../voice/MicButton";

const MAX_TOTAL = 3_500_000;

export function ComposerHost() {
  const { requests, close } = useComposer();
  return <>{requests.map((r) => <Composer key={r.key} request={r} onClose={() => close(r.key)} />)}</>;
}

interface Initial {
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  quote: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments: OutgoingAttachment[];
  draftId?: string;
  aiGenerated: boolean;
  thread?: ThreadDetail;
  /** Opened from a voice command: saved to Gmail Drafts right away, never sent automatically. */
  voice?: boolean;
}

function initialFrom(r: ComposeRequest, defaultAccount: string): Initial | null {
  if (r.mode === "new") {
    return { accountId: r.accountId ?? defaultAccount, to: r.to ? [r.to] : [], cc: [], bcc: [], subject: r.subject ?? "", bodyHtml: r.bodyText ? textToParagraphs(r.bodyText) : "", quote: "", attachments: [], aiGenerated: Boolean(r.aiGenerated), voice: r.voice };
  }
  if (r.mode === "draft") return null;
  const { thread, message } = r;
  const refs = [message.references, message.messageIdHeader].filter(Boolean).join(" ") || undefined;
  if (r.mode === "forward") {
    return {
      accountId: thread.accountId, to: [], cc: [], bcc: [], subject: forwardSubject(message.subject || thread.subject),
      bodyHtml: r.bodyText ? textToParagraphs(r.bodyText) : "", quote: forwardHtml(message),
      attachments: message.attachments.filter((a) => !a.inline).map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, source: { messageId: a.messageId, attachmentId: a.attachmentId } })),
      aiGenerated: Boolean(r.aiGenerated), thread,
    };
  }
  const rec = replyRecipients(thread, message, r.mode === "replyAll");
  return {
    accountId: thread.accountId, to: rec.to, cc: rec.cc, bcc: [], subject: replySubject(message.subject || thread.subject),
    bodyHtml: r.bodyText ? textToParagraphs(r.bodyText) : "", quote: quoteHtml(message), threadId: thread.id,
    inReplyTo: message.messageIdHeader || undefined, references: refs, attachments: [], aiGenerated: Boolean(r.aiGenerated), thread, voice: r.voice,
  };
}

function Composer({ request, onClose }: { request: ComposeRequest & { key: number }; onClose: () => void }) {
  const { session } = useSession();
  const defaultAccount = session?.accounts?.find((a) => a.status === "active")?.id ?? session?.accounts?.[0]?.id ?? "";
  const [init, setInit] = useState<Initial | null>(() => initialFrom(request, defaultAccount));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (request.mode !== "draft") return;
    api.get<{ draftId: string; accountId: string; to: Array<{ name: string; email: string }>; cc: Array<{ name: string; email: string }>; bcc: Array<{ name: string; email: string }>; subject: string; html: string | null; text: string | null; threadId: string; inReplyTo: string | null; references: string | null; attachments: Array<{ filename: string; mimeType: string; size: number; messageId: string; attachmentId: string }> }>(`/compose/drafts/${request.accountId}/${request.draftId}`)
      .then((d) => setInit({
        accountId: d.accountId, to: d.to.map(fmtAddr), cc: d.cc.map(fmtAddr), bcc: d.bcc.map(fmtAddr), subject: d.subject,
        bodyHtml: d.html ?? textToParagraphs(d.text ?? ""), quote: "", threadId: d.inReplyTo ? d.threadId : undefined,
        inReplyTo: d.inReplyTo ?? undefined, references: d.references ?? undefined, draftId: d.draftId, aiGenerated: false,
        attachments: d.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, source: { messageId: a.messageId, attachmentId: a.attachmentId } })),
      }))
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, [request]);

  if (loadError) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Couldn't open draft" description={loadError}>
        <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
      </Dialog>
    );
  }
  if (!init) {
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-fg-2 shadow-[var(--shadow)]">
        <Loader2 className="size-4 animate-spin" /> Opening draft…
      </div>
    );
  }
  return <ComposerForm init={init} mode={request.mode} onClose={onClose} />;
}

function ComposerForm({ init, mode, onClose }: { init: Initial; mode: ComposeRequest["mode"]; onClose: () => void }) {
  const { session, config } = useSession();
  const qc = useQueryClient();
  const accounts = session?.accounts ?? [];
  const [accountId, setAccountId] = useState(init.accountId);
  const [to, setTo] = useState(init.to);
  const [cc, setCc] = useState(init.cc);
  const [bcc, setBcc] = useState(init.bcc);
  const [showCc, setShowCc] = useState(init.cc.length > 0 || init.bcc.length > 0);
  const [subject, setSubject] = useState(init.subject);
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>(init.attachments);
  const [includeQuote, setIncludeQuote] = useState(Boolean(init.quote));
  const [aiGenerated, setAiGenerated] = useState(init.aiGenerated);
  const [draftId, setDraftId] = useState(init.draftId);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(init.draftId ? "saved" : "idle");
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [confirmAi, setConfirmAi] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [undoHtml, setUndoHtml] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplate, setSaveTemplate] = useState<Partial<Template> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const aiOn = Boolean(config?.ai) && session?.settings?.ai.enabled !== false;
  const signature = session?.settings?.ai.signature ?? "";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } }, heading: false, codeBlock: false }),
      Placeholder.configure({ placeholder: mode === "forward" ? "Add a message…" : "Write your message…" }),
    ],
    content: init.bodyHtml || (signature && mode !== "draft" ? `<p></p><p>${signature.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>` : ""),
    editorProps: { attributes: { class: "tiptap px-4 py-3 text-[14px] text-fg", "aria-label": "Message body", role: "textbox", "aria-multiline": "true" } },
    onUpdate: () => setDirty(true),
    immediatelyRender: true,
  });

  const totalSize = attachments.reduce((s, a) => s + a.size, 0);
  const payload = useCallback((): SendPayload => {
    const html = editor?.getHTML() ?? "";
    const quote = includeQuote ? init.quote : "";
    return {
      accountId, to, cc, bcc, subject,
      html: html + quote,
      text: htmlToPlain(html) + (quote ? `\n\n${htmlToPlain(quote)}` : ""),
      threadId: init.threadId, inReplyTo: init.inReplyTo, references: init.references,
      attachments, draftId, aiGenerated, aiConfirmed: false,
    };
  }, [editor, includeQuote, init, accountId, to, cc, bcc, subject, attachments, draftId, aiGenerated]);

  const saveDraft = useCallback(async (silent = true): Promise<boolean> => {
    if (!editor) return false;
    setSaveState("saving");
    try {
      const { aiConfirmed: _a, aiGenerated: _g, ...p } = payload();
      const valid = (xs: string[]) => xs.filter((x) => EMAIL_RE.test(x));
      const r = await api.post<{ draftId: string }>("/compose/drafts", { ...p, to: valid(p.to), cc: valid(p.cc), bcc: valid(p.bcc) });
      setDraftId(r.draftId);
      setSaveState("saved");
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ["drafts"] });
      void qc.invalidateQueries({ queryKey: ["labels"] });
      if (!silent) toast.success("Draft saved to Gmail");
      return true;
    } catch (err) {
      setSaveState("error");
      if (!silent) toast.error(errorMessage(err));
      return false;
    }
  }, [editor, payload, qc]);

  // A voice command only ever produces a draft: save it to Gmail straight away so it exists even if the window is closed.
  useEffect(() => {
    if (!init.voice) return;
    void saveDraft(true).then((ok) => { if (ok) toast.success("Draft saved to Gmail", { description: "Nothing was sent. Review it and press Send when you're ready." }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave 3s after the last change.
  useEffect(() => {
    if (!dirty || hidden) return;
    const t = window.setTimeout(() => void saveDraft(true), 3000);
    return () => window.clearTimeout(t);
  }, [dirty, hidden, saveDraft, to, cc, bcc, subject, attachments]);

  const markDirty = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  const close = async () => {
    const empty = !to.length && !subject && !(editor?.getText().trim()) && !attachments.length;
    if (dirty && !empty) {
      const ok = await saveDraft(true);
      if (ok) toast("Draft saved", { description: "Find it in Drafts." });
    }
    onClose();
  };

  const discard = async () => {
    setConfirmDiscard(false);
    if (draftId) {
      try {
        await api.del(`/compose/drafts/${accountId}/${draftId}`);
        void qc.invalidateQueries({ queryKey: ["drafts"] });
      } catch (err) {
        toast.error(errorMessage(err));
        return;
      }
    }
    toast("Draft discarded");
    onClose();
  };

  const send = async (aiConfirmed: boolean) => {
    const all = [...to, ...cc, ...bcc];
    if (!all.length) return toast.error("Add at least one recipient.");
    const bad = all.find((x) => !EMAIL_RE.test(x));
    if (bad) return toast.error(`“${bad}” isn't a valid email address.`);
    if (totalSize > MAX_TOTAL) return toast.error("Attachments exceed 3.5 MB.");
    if (aiGenerated && !aiConfirmed) {
      setConfirmAi(true);
      return;
    }
    if (!subject.trim() && !window.confirm("Send without a subject?")) return;
    setSending(true);
    const body = { ...payload(), aiConfirmed };
    // Hide the composer during the undo window; it stays mounted so Undo restores everything.
    setHidden(true);
    setConfirmAi(false);
    sendWithUndo({
      seconds: Number(session?.settings?.compose?.undoSendSeconds ?? "5"),
      label: "Sending message…",
      onUndo: () => {
        setHidden(false);
        setSending(false);
        toast("Sending cancelled", { description: "Your message is back in the composer." });
      },
      run: async () => {
        try {
          await api.post("/compose/send", body);
          toast.success("Message sent");
          void qc.invalidateQueries({ queryKey: ["threads"] });
          void qc.invalidateQueries({ queryKey: ["drafts"] });
          if (init.thread) void qc.invalidateQueries({ queryKey: ["thread", init.thread.accountId, init.thread.id] });
          onClose();
        } catch (err) {
          toast.error(errorMessage(err));
          setHidden(false);
          setSending(false);
        }
      },
    });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next = [...attachments];
    let total = totalSize;
    for (const f of Array.from(files)) {
      if (total + f.size > MAX_TOTAL) {
        toast.error(`“${f.name}” would exceed the 3.5 MB attachment limit.`);
        continue;
      }
      total += f.size;
      next.push({ filename: f.name, mimeType: f.type || "application/octet-stream", size: f.size, data: await fileToBase64(f) });
    }
    setAttachments(next);
    setDirty(true);
  };

  const applyAi = (text: string) => {
    if (!editor) return;
    setUndoHtml(editor.getHTML());
    editor.commands.setContent(textToParagraphs(text) + (signature ? `<p>${signature.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>` : ""));
    setAiGenerated(true);
    setDirty(true);
  };

  const rewrite = async (operation: "shorter" | "longer" | "fix" | "tone", tone?: string) => {
    const text = editor?.getText().trim();
    if (!text) return toast.error("Write something first, then ask AI to rewrite it.");
    setAiBusy(true);
    try {
      const r = await api.post<{ text: string }>("/ai/rewrite", { text, operation, tone });
      applyAi(r.text);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAiBusy(false);
    }
  };

  const insertTemplate = (t: Template) => {
    if (!editor) return;
    editor.chain().focus().insertContent(templateToHtml(t.body)).run();
    if (t.subject && !subject.trim()) setSubject(t.subject);
    setDirty(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (templatesOpen || saveTemplate) return; // keys inside the template dialogs bubble through the portal
    if (isTemplateShortcut(e)) {
      e.preventDefault();
      setTemplatesOpen(true);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send(false);
    } else if (e.key === "Escape" && !confirmAi && !confirmDiscard && !aiOpen) {
      e.preventDefault();
      void close();
    }
  };

  const title = mode === "reply" || mode === "replyAll" ? "Reply" : mode === "forward" ? "Forward" : mode === "draft" ? "Draft" : "New message";
  const accountEmail = accounts.find((a) => a.id === accountId)?.email;

  return (
    <div
      role="dialog"
      data-composer=""
      aria-label={title}
      aria-modal="false"
      hidden={hidden}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden border border-line-strong bg-surface shadow-[var(--shadow)] animate-in",
        "inset-0 sm:inset-auto",
        maximized ? "sm:inset-6 sm:rounded-2xl" : "sm:bottom-4 sm:right-4 sm:h-[min(640px,calc(100dvh-32px))] sm:w-[620px] sm:rounded-2xl",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-4">
        <h2 className="flex-1 text-[14px] font-semibold text-fg">{subject || title}</h2>
        <span className="text-[11.5px] text-fg-3" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved to Drafts" : saveState === "error" ? "Not saved" : ""}
        </span>
        <IconButton label={maximized ? "Restore size" : "Maximize"} size="sm" className="hidden sm:inline-flex" onClick={() => setMaximized((v) => !v)}>
          {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </IconButton>
        <IconButton label="Close (saves draft)" size="sm" onClick={() => void close()}><X className="size-4" /></IconButton>
      </div>

      {accounts.length > 1 && (
        <div className="flex h-10 items-center gap-2 border-b border-line px-4">
          <label htmlFor="compose-from" className="w-14 shrink-0 text-[13px] text-fg-3">From</label>
          <select id="compose-from" value={accountId} onChange={(e) => { setAccountId(e.target.value); setDraftId(undefined); setDirty(true); }} disabled={Boolean(init.thread)} className="h-8 flex-1 bg-transparent text-[13.5px] text-fg outline-none">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name ? `${a.name} <${a.email}>` : a.email}</option>)}
          </select>
        </div>
      )}
      <div className="relative">
        <RecipientInput id="compose-to" label="To" values={to} onChange={markDirty(setTo)} autoFocus={mode === "new" || mode === "forward"} />
        {!showCc && (
          <button type="button" onClick={() => setShowCc(true)} className="absolute right-3 top-2.5 rounded px-1.5 text-[12.5px] text-fg-3 hover:text-fg">Cc/Bcc</button>
        )}
      </div>
      {showCc && (
        <>
          <RecipientInput id="compose-cc" label="Cc" values={cc} onChange={markDirty(setCc)} />
          <RecipientInput id="compose-bcc" label="Bcc" values={bcc} onChange={markDirty(setBcc)} />
        </>
      )}
      <div className="flex h-10 items-center gap-2 border-b border-line px-4">
        <label htmlFor="compose-subject" className="w-14 shrink-0 text-[13px] text-fg-3">Subject</label>
        <input id="compose-subject" value={subject} onChange={(e) => { setSubject(e.target.value); setDirty(true); }} className="h-8 flex-1 bg-transparent text-[13.5px] text-fg outline-none" maxLength={900} />
      </div>

      <Toolbar editor={editor} />

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin" onClick={() => editor?.commands.focus()}>
        {aiGenerated && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-1.5 text-[12px] text-ai-title">
            <Sparkles className="size-3.5" aria-hidden />
            <span className="flex-1">Contains AI-written text. You'll be asked to confirm before sending.</span>
            {undoHtml !== null && (
              <button type="button" className="flex items-center gap-1 font-medium hover:underline" onClick={(e) => { e.stopPropagation(); editor?.commands.setContent(undoHtml); setUndoHtml(null); }}>
                <Undo2 className="size-3" /> Undo AI
              </button>
            )}
          </div>
        )}
        {init.voice && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-[12px] text-fg-2" data-voice-draft="">
            <span className="flex-1">Drafted from your voice command. It's saved in Drafts and won't be sent unless you press Send.</span>
          </div>
        )}
        <EditorContent editor={editor} />
        {init.quote && (
          <div className="px-4 pb-3">
            <button type="button" onClick={(e) => { e.stopPropagation(); setIncludeQuote((v) => !v); }} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-fg-3 hover:text-fg" aria-pressed={includeQuote}>
              {includeQuote ? (mode === "forward" ? "Forwarded message included ✓" : "Quoted text included ✓") : "Quoted text removed — click to include"}
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-4 pb-4" aria-label="Attachments">
            {attachments.map((a, i) => (
              <li key={`${a.filename}-${i}`} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px]">
                <FileText className="size-3.5 text-fg-3" aria-hidden />
                <span className="max-w-[180px] truncate text-fg">{a.filename}</span>
                <span className="text-fg-3">{formatBytes(a.size)}</span>
                <button type="button" aria-label={`Remove ${a.filename}`} className="text-fg-3 hover:text-fg" onClick={(e) => { e.stopPropagation(); setAttachments(attachments.filter((_, j) => j !== i)); setDirty(true); }}><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-3 py-2.5">
        <Button variant="primary" onClick={() => void send(false)} loading={sending} icon={<Send className="size-4" />}>Send</Button>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} aria-label="Attach files" />
        <IconButton label="Attach files" onClick={() => fileRef.current?.click()}><Paperclip className="size-[18px]" /></IconButton>
        <IconButton label={`Insert template (${TEMPLATE_SHORTCUT_LABEL})`} onClick={() => setTemplatesOpen(true)}><FileStack className="size-[18px]" /></IconButton>
        <MicButton onText={(t) => editor?.chain().focus().insertContent({ type: "text", text: `${t} ` }).run()} />
        {aiOn && (
          <>
            <Button variant="ai" size="md" icon={<Sparkles className="size-3.5" />} onClick={() => setAiOpen(true)} disabled={aiBusy}>Write with AI</Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="md" disabled={aiBusy} icon={aiBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}>
                  Rewrite <ChevronDown className="size-3.5" />
                </Button>
              </MenuTrigger>
              <MenuContent align="start">
                <MenuItem onSelect={() => void rewrite("shorter")}>Make shorter</MenuItem>
                <MenuItem onSelect={() => void rewrite("longer")}>Make more detailed</MenuItem>
                <MenuItem onSelect={() => void rewrite("fix")}>Fix spelling & grammar</MenuItem>
                <MenuSeparator />
                <MenuLabel>Change tone</MenuLabel>
                {["professional", "friendly", "concise", "warm", "formal"].map((t) => (
                  <MenuItem key={t} onSelect={() => void rewrite("tone", t)}>{t[0]!.toUpperCase() + t.slice(1)}</MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </>
        )}
        <div className="flex-1" />
        {accountEmail && accounts.length > 1 && <span className="hidden max-w-[160px] truncate text-[11.5px] text-fg-3 sm:inline">{accountEmail}</span>}
        <IconButton label="Save draft now" onClick={() => void saveDraft(false)}><FileText className="size-[18px]" /></IconButton>
        <IconButton label="Discard draft" onClick={() => setConfirmDiscard(true)}><Trash2 className="size-[18px]" /></IconButton>
      </div>

      <TemplatePicker
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onPick={insertTemplate}
        onSaveCurrent={() => setSaveTemplate({ subject: init.thread ? "" : subject, body: htmlToPlain(editor?.getHTML() ?? "") })}
      />
      <TemplateEditorDialog open={saveTemplate !== null} onOpenChange={(o) => !o && setSaveTemplate(null)} initial={saveTemplate ?? undefined} />
      <AiWriteDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        threadContext={init.thread ? { accountId: init.thread.accountId, threadId: init.thread.id } : undefined}
        mode={mode === "forward" ? "forward" : init.thread ? "reply" : "new"}
        onResult={(r) => { applyAi(r.body); if (r.subject && !subject) setSubject(r.subject); }}
      />
      <ConfirmDialog
        open={confirmAi}
        onOpenChange={setConfirmAi}
        title="Send AI-assisted message?"
        description="This message contains text written by AI. FLUENT never sends AI content without your explicit confirmation."
        confirmLabel="Yes, send it"
        loading={sending}
        onConfirm={() => void send(true)}
      >
        <div className="space-y-1 rounded-lg bg-surface-2 p-3 text-[12.5px] text-fg-2">
          <p><span className="text-fg-3">To:</span> {[...to, ...cc, ...bcc].join(", ")}</p>
          <p><span className="text-fg-3">Subject:</span> {subject || "(no subject)"}</p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap pt-1 text-fg">{editor?.getText()}</p>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this draft?"
        description={draftId ? "The draft will be deleted from Gmail." : "Your message will be lost."}
        confirmLabel="Discard"
        danger
        onConfirm={() => void discard()}
      />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const f = () => force((n) => n + 1);
    editor.on("selectionUpdate", f);
    editor.on("transaction", f);
    return () => {
      editor.off("selectionUpdate", f);
      editor.off("transaction", f);
    };
  }, [editor]);
  if (!editor) return null;
  const btn = (label: string, active: boolean, onClick: () => void, icon: React.ReactNode) => (
    <IconButton label={label} size="sm" active={active} aria-pressed={active} onClick={onClick} className={active ? "bg-surface-3" : ""}>{icon}</IconButton>
  );
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-3 py-1" role="toolbar" aria-label="Formatting">
      {btn("Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold className="size-4" />)}
      {btn("Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic className="size-4" />)}
      {btn("Underline", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <Underline className="size-4" />)}
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      {btn("Bulleted list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List className="size-4" />)}
      {btn("Numbered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered className="size-4" />)}
      {btn("Quote", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), <Quote className="size-4" />)}
      {btn("Link", editor.isActive("link"), () => {
        if (editor.isActive("link")) return editor.chain().focus().unsetLink().run();
        const url = window.prompt("Link URL (https://…)");
        if (url && /^(https?:\/\/|mailto:)/i.test(url)) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        else if (url) toast.error("Links must start with https://, http:// or mailto:");
      }, <Link2 className="size-4" />)}
    </div>
  );
}

function AiWriteDialog({ open, onOpenChange, threadContext, mode, onResult }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  threadContext?: { accountId: string; threadId: string };
  mode: "new" | "reply" | "forward";
  onResult: (r: { body: string; subject: string | null }) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const examples = useMemo(() => mode === "reply"
    ? ["Accept and confirm the time", "Politely decline, suggest next week", "Ask for more details"]
    : ["Follow up on the proposal I sent last week", "Thank the team for the launch", "Request a meeting next Tuesday"], [mode]);
  const go = async () => {
    if (!instruction.trim() && mode !== "reply") return;
    setBusy(true);
    try {
      const r = await api.post<{ body: string; subject: string | null }>("/ai/draft", { ...threadContext, mode, instruction: instruction.trim() || undefined });
      onResult(r);
      setInstruction("");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Write with AI" description={threadContext ? "The AI reads this conversation to draft a reply. Nothing is sent until you confirm." : "Describe what you want to say. Nothing is sent until you confirm."}>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} className="space-y-3">
        <label htmlFor="ai-instruction" className="sr-only">Instruction</label>
        <Textarea id="ai-instruction" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={mode === "reply" ? "Optional: how should the reply go?" : "What should this email say?"} autoFocus maxLength={1000} />
        <div className="flex flex-wrap gap-1.5">
          {examples.map((ex) => (
            <button key={ex} type="button" onClick={() => setInstruction(ex)} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-fg-2 hover:text-fg">{ex}</button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} icon={<Sparkles className="size-4" />} disabled={!instruction.trim() && mode !== "reply"}>Generate</Button>
        </div>
      </form>
    </Dialog>
  );
}
