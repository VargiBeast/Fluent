import { useEffect, useRef, useState } from "react";
import { Lock, Pencil, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ThreadDetail } from "@shared/mail";
import { NOTE_LIMITS } from "@shared/notes";
import { Button, IconButton } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { relative } from "@/lib/format";
import { noteDraft, useDeleteNote, useSaveNote, useThreadNote } from "@/lib/notes";

/** Toolbar toggle for the private note (shortcut: n). */
export function NoteButton({ thread, onClick }: { thread: ThreadDetail; onClick: () => void }) {
  const note = useThreadNote(thread.accountId, thread.id);
  const has = Boolean(note.data);
  return (
    <IconButton label={has ? "Edit private note (n)" : "Add private note (n)"} active={has} onClick={onClick} data-note-trigger="">
      <StickyNote className="size-[18px]" />
    </IconButton>
  );
}

/**
 * A private note pinned to the conversation: only visible to you in FLUENT, encrypted at rest,
 * never added to the email, sent to Gmail or shared with the AI.
 */
export function ThreadNotePanel({ thread, editing, onEditingChange }: { thread: ThreadDetail; editing: boolean; onEditingChange: (v: boolean) => void }) {
  const note = useThreadNote(thread.accountId, thread.id);
  const save = useSaveNote(thread.accountId, thread.id);
  const del = useDeleteNote(thread.accountId, thread.id);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    setText(note.data?.body ?? "");
    requestAnimationFrame(() => ref.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!editing && !note.data) return null;

  const submit = () => {
    const body = noteDraft(text);
    if (!body) {
      if (note.data) del.mutate(undefined, { onSuccess: () => { onEditingChange(false); toast.success("Note deleted"); } });
      else onEditingChange(false);
      return;
    }
    save.mutate(body, { onSuccess: () => { onEditingChange(false); toast.success("Note saved"); } });
  };

  return (
    <section aria-label="Private note" className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3">
      <div className="mb-1.5 flex items-center gap-2 text-[12px] text-fg-3">
        <StickyNote className="size-3.5 text-amber-400" aria-hidden />
        <span className="font-medium text-fg-2">Private note</span>
        <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden />Only you can see this</span>
        {note.data && !editing && <span>· edited {relative(note.data.updatedAt)}</span>}
        <div className="flex-1" />
        {note.data && !editing && (
          <>
            <IconButton size="sm" label="Edit note" onClick={() => onEditingChange(true)}><Pencil className="size-3.5" /></IconButton>
            <IconButton size="sm" label="Delete note" onClick={() => del.mutate(undefined, { onSuccess: () => toast.success("Note deleted") })}><Trash2 className="size-3.5" /></IconButton>
          </>
        )}
      </div>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-2">
          <Textarea
            ref={ref}
            aria-label="Private note"
            value={text}
            maxLength={NOTE_LIMITS.body}
            rows={3}
            placeholder="Write a note for yourself about this conversation…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEditingChange(false); }
            }}
          />
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-fg-3">{text.length}/{NOTE_LIMITS.body}</span>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => onEditingChange(false)}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" loading={save.isPending || del.isPending}>Save note</Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-fg">{note.data!.body}</p>
      )}
    </section>
  );
}
