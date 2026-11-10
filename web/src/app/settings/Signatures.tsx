import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { toast } from "sonner";
import { AlertTriangle, Bold, Italic, Link2, List, PenLine, Underline } from "lucide-react";
import type { SendAsAccount, SendAsIdentity } from "@shared/sendas";
import { SENDAS_LIMITS } from "@shared/sendas";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Badge, Skeleton } from "@/components/ui/misc";
import { errorMessage } from "@/lib/api";
import { buildSrcDoc, sanitizeEmailHtml } from "@/lib/sanitize";
import { htmlToPlain } from "@/lib/compose";
import { isEmptySignature, signatureNeedsRichEditor, useSendAs, useUpdateSendAs } from "@/lib/sendas";
import { useUpdateSettings } from "@/lib/settings";
import { useSession } from "@/lib/session";

export function SignaturesSection() {
  const q = useSendAs();
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  if (q.isError) return <p className="text-[13px] text-danger">{errorMessage(q.error)}</p>;
  const accounts = q.data ?? [];
  if (!accounts.length) return <p className="text-[13px] text-fg-3">Connect a Gmail account to manage its sender name and signature.</p>;
  return (
    <>
      <p className="text-[13px] text-fg-3">
        These are your Gmail settings: changes apply in Gmail on the web and on your phone too. FLUENT uses the sender name in the From line of mail you send.
      </p>
      {accounts.map((a) => <AccountIdentities key={a.accountId} account={a} />)}
    </>
  );
}

function AccountIdentities({ account }: { account: SendAsAccount }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface" aria-label={`Send-as settings for ${account.email}`}>
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[14.5px] font-semibold text-fg">{account.email}</h2>
        {account.error && <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-warning"><AlertTriangle className="size-3.5" />{account.error.message}</p>}
      </div>
      <div className="divide-y divide-line px-5">
        {account.identities.map((i) => <IdentityEditor key={i.sendAsEmail} accountId={account.accountId} identity={i} />)}
      </div>
    </section>
  );
}

function IdentityEditor({ accountId, identity }: { accountId: string; identity: SendAsIdentity }) {
  const update = useUpdateSendAs();
  const updateSettings = useUpdateSettings();
  const { session } = useSession();
  const [name, setName] = useState(identity.displayName);
  const [editing, setEditing] = useState(false);
  const [confirmLossy, setConfirmLossy] = useState(false);
  useEffect(() => setName(identity.displayName), [identity.displayName]);
  const lossy = signatureNeedsRichEditor(identity.signature);
  const empty = isEmptySignature(identity.signature);

  const save = (patch: { displayName?: string; signature?: string }, done?: () => void) =>
    update.mutate({ accountId, email: identity.sendAsEmail, patch }, {
      onSuccess: () => { toast.success("Saved to Gmail"); done?.(); },
      onError: (e) => toast.error(errorMessage(e)),
    });

  const plain = htmlToPlain(identity.signature).slice(0, 500);
  const fluentSig = session?.settings?.ai.signature ?? "";

  return (
    <div className="space-y-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13.5px] font-medium text-fg">{identity.sendAsEmail}</p>
        {identity.isPrimary && <Badge tone="muted">Primary</Badge>}
        {identity.isDefault && <Badge tone="muted">Default</Badge>}
        {!identity.verified && <Badge tone="danger">Unverified</Badge>}
      </div>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); save({ displayName: name.trim() }); }}>
        <div className="flex-1">
          <Field label="Sender name" hint="Shown to recipients in the From line.">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={SENDAS_LIMITS.displayName} placeholder="Your name" />}
          </Field>
        </div>
        <Button type="submit" variant="primary" loading={update.isPending && update.variables?.patch.displayName !== undefined} disabled={name.trim() === identity.displayName}>Save name</Button>
      </form>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-fg-2">Gmail signature</p>
          {!editing && (
            <Button size="sm" icon={<PenLine className="size-3.5" />} onClick={() => (lossy ? setConfirmLossy(true) : setEditing(true))}>
              {empty ? "Add signature" : "Edit signature"}
            </Button>
          )}
        </div>
        {confirmLossy && !editing && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-fg-2">
            <AlertTriangle className="size-4 text-warning" aria-hidden />
            <span className="flex-1">This signature has images or custom styling. The FLUENT editor keeps text, bold, italic, lists and links only; saving here removes the rest.</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmLossy(false)}>Keep it</Button>
            <Button size="sm" onClick={() => { setConfirmLossy(false); setEditing(true); }}>Edit anyway</Button>
          </div>
        )}
        {editing ? (
          <SignatureEditor
            initial={identity.signature}
            saving={update.isPending}
            onCancel={() => setEditing(false)}
            onSave={(html) => save({ signature: html }, () => setEditing(false))}
          />
        ) : empty ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-fg-3">No Gmail signature.</p>
        ) : (
          <SignaturePreview html={identity.signature} label={`Signature for ${identity.sendAsEmail}`} />
        )}
        {!empty && !editing && identity.isDefault && (
          <p className="text-[12px] text-fg-3">
            {fluentSig.trim() === plain.trim() ? "FLUENT's composer adds this signature (as plain text)." : (
              <>FLUENT's composer adds its own signature from AI preferences. <button type="button" className="text-accent-400 hover:underline" onClick={() => updateSettings.mutate({ ai: { signature: plain } }, { onSuccess: () => toast.success("FLUENT will use your Gmail signature") })}>Use this one in FLUENT too</button></>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/** Rendered like an email: sanitised, in a script-less sandboxed iframe. */
function SignaturePreview({ html, label }: { html: string; label: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);
  const [images, setImages] = useState(false);
  const dark = document.documentElement.classList.contains("dark");
  const r = useMemo(() => {
    const s = sanitizeEmailHtml(html, { allowRemoteImages: images });
    return { ...s, srcDoc: buildSrcDoc(s.html, { dark, rich: s.rich, allowRemoteImages: images, showQuoted: true }) };
  }, [html, images, dark]);
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    const onLoad = () => setHeight(Math.min(Math.max(f.contentDocument?.documentElement.scrollHeight ?? 40, 24), 600));
    f.addEventListener("load", onLoad);
    return () => f.removeEventListener("load", onLoad);
  }, [r.srcDoc]);
  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-surface-2 p-3">
      <iframe ref={frame} title={label} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={r.srcDoc} className="block w-full border-0" style={{ height }} />
      {r.blockedImages > 0 && !images && (
        <button type="button" className="text-[12px] text-accent-400 hover:underline" onClick={() => setImages(true)}>Show images</button>
      )}
    </div>
  );
}

function SignatureEditor({ initial, saving, onSave, onCancel }: { initial: string; saving: boolean; onSave: (html: string) => void; onCancel: () => void }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } }, heading: false, codeBlock: false })],
    content: sanitizeEmailHtml(initial, { allowRemoteImages: false }).html,
    editorProps: { attributes: { class: "tiptap min-h-[96px] px-3 py-2 text-[13.5px] text-fg", "aria-label": "Signature", role: "textbox", "aria-multiline": "true" } },
    immediatelyRender: true,
  });
  if (!editor) return null;
  const tooLong = () => editor.getHTML().length > SENDAS_LIMITS.signature;
  const link = () => {
    if (editor.isActive("link")) return editor.chain().focus().unsetLink().run();
    const url = window.prompt("Link URL (https://…)");
    if (url && /^(https?:\/\/|mailto:)/i.test(url)) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    else if (url) toast.error("Links must start with https://, http:// or mailto:");
  };
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-2 focus-within:border-accent">
      <div className="flex items-center gap-0.5 border-b border-line px-2 py-1" role="toolbar" aria-label="Signature formatting">
        <IconButton label="Bold" size="sm" onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" /></IconButton>
        <IconButton label="Italic" size="sm" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></IconButton>
        <IconButton label="Underline" size="sm" onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline className="size-4" /></IconButton>
        <IconButton label="Bulleted list" size="sm" onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="size-4" /></IconButton>
        <IconButton label="Link" size="sm" onClick={link}><Link2 className="size-4" /></IconButton>
      </div>
      <EditorContent editor={editor} />
      <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" loading={saving} onClick={() => {
          if (tooLong()) return toast.error("Signatures are limited to 10,000 characters of HTML.");
          onSave(editor.isEmpty ? "" : editor.getHTML());
        }}>Save signature</Button>
      </div>
    </div>
  );
}
