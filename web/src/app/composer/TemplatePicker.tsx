import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FileStack, Plus } from "lucide-react";
import type { Template } from "@shared/templates";
import { TEMPLATE_LIMITS } from "@shared/templates";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Kbd, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/api";
import { filterTemplates, TEMPLATE_SHORTCUT_LABEL, useSaveTemplate, useTemplates } from "@/lib/templates";

/** Searchable list of saved replies. Arrow keys move, Enter inserts at the cursor. */
export function TemplatePicker({ open, onOpenChange, onPick, onSaveCurrent }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (t: Template) => void;
  onSaveCurrent: () => void;
}) {
  const q = useTemplates(open);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useMemo(() => filterTemplates(q.data ?? [], query), [q.data, query]);
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const pick = (t: Template | undefined) => {
    if (!t) return;
    onPick(t);
    onOpenChange(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(list[active]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Insert a template" description={<>Saved replies are inserted at the cursor. Shortcut: <Kbd>{TEMPLATE_SHORTCUT_LABEL}</Kbd></>} wide>
      <div className="space-y-3" onKeyDown={onKey}>
        <label htmlFor="template-search" className="sr-only">Search templates</label>
        <Input id="template-search" autoFocus placeholder="Search templates…" value={query} onChange={(e) => setQuery(e.target.value)} role="combobox" aria-expanded="true" aria-controls="template-list" aria-activedescendant={list[active] ? `tpl-${list[active].id}` : undefined} />
        {q.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        ) : q.isError ? (
          <p className="text-[13px] text-danger">{errorMessage(q.error)}</p>
        ) : !q.data?.length ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-3">
            <FileStack className="mx-auto mb-2 size-5 text-accent-400" aria-hidden />
            No templates yet. Save this message as one, or create them in Settings.
          </div>
        ) : list.length === 0 ? (
          <p className="px-1 py-4 text-center text-[13px] text-fg-3">No template matches “{query}”.</p>
        ) : (
          <ul id="template-list" role="listbox" aria-label="Templates" className="max-h-[320px] divide-y divide-line overflow-y-auto rounded-xl border border-line scroll-thin">
            {list.map((t, i) => (
              <li key={t.id} id={`tpl-${t.id}`} role="option" aria-selected={i === active}>
                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(t)} className={cn("block w-full px-4 py-2.5 text-left", i === active ? "bg-accent-soft" : "hover:bg-surface-2")}>
                  <span className="block truncate text-[13.5px] font-medium text-fg">{t.name}</span>
                  <span className="block truncate text-[12.5px] text-fg-3">{t.subject ? `${t.subject} — ` : ""}{t.body.replace(/\s+/g, " ")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          <Link to="/app/settings/templates" onClick={() => onOpenChange(false)} className="text-[12.5px] text-accent-400 hover:underline">Manage templates</Link>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => { onOpenChange(false); onSaveCurrent(); }}>Save this message as a template</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Create or edit a template. Used from the composer ("save as template") and from Settings. */
export function TemplateEditorDialog({ open, onOpenChange, initial, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<Template>;
  onSaved?: (t: Template) => void;
}) {
  const save = useSaveTemplate();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setSubject(initial?.subject ?? "");
      setBody(initial?.body ?? "");
    }
  }, [open, initial]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ id: initial?.id, name: name.trim(), subject: subject.trim(), body }, {
      onSuccess: (t) => {
        toast.success(initial?.id ? "Template updated" : "Template saved");
        onSaved?.(t);
        onOpenChange(false);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={initial?.id ? "Edit template" : "New template"} description="Templates are plain text. Only you can see them; they're stored encrypted." wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={TEMPLATE_LIMITS.name} required autoFocus placeholder="e.g. Meeting times" />}</Field>
        <Field label="Subject (optional)" hint="Used only when the message has no subject yet.">{(id) => <Input id={id} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={TEMPLATE_LIMITS.subject} />}</Field>
        <Field label="Text">{(id) => (
          <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={TEMPLATE_LIMITS.body} required className="w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]" />
        )}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!name.trim() || !body.trim()}>Save template</Button>
        </div>
      </form>
    </Dialog>
  );
}
