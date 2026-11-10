import { useState } from "react";
import { toast } from "sonner";
import { FileStack, Pencil, Plus, Trash2 } from "lucide-react";
import type { Template } from "@shared/templates";
import { TEMPLATE_LIMITS } from "@shared/templates";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Kbd, Skeleton } from "@/components/ui/misc";
import { errorMessage } from "@/lib/api";
import { TEMPLATE_SHORTCUT_LABEL, useDeleteTemplate, useTemplates } from "@/lib/templates";
import { TemplateEditorDialog } from "../composer/TemplatePicker";

export function TemplatesSection() {
  const q = useTemplates();
  const del = useDeleteTemplate();
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const list = q.data ?? [];
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[14.5px] font-semibold text-fg">Templates</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-3">Saved replies you can insert in the composer from the Templates button or with <Kbd>{TEMPLATE_SHORTCUT_LABEL}</Kbd>. Up to {TEMPLATE_LIMITS.maxPerUser}.</p>
        </div>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing({})} disabled={list.length >= TEMPLATE_LIMITS.maxPerUser}>New template</Button>
      </div>
      <div className="px-5 py-3">
        {q.isLoading ? (
          <div className="space-y-2 py-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : q.isError ? (
          <p className="py-3 text-[13px] text-danger">{errorMessage(q.error)}</p>
        ) : list.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-fg-3">
            <FileStack className="mx-auto mb-2 size-5 text-accent-400" aria-hidden />
            No templates yet.
          </div>
        ) : (
          <ul className="divide-y divide-line" aria-label="Templates">
            {list.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-fg">{t.name}</p>
                  <p className="truncate text-[12.5px] text-fg-3">{t.subject ? `${t.subject} — ` : ""}{t.body.replace(/\s+/g, " ")}</p>
                </div>
                <IconButton label={`Edit ${t.name}`} size="sm" onClick={() => setEditing(t)}><Pencil className="size-4" /></IconButton>
                <IconButton label={`Delete ${t.name}`} size="sm" onClick={() => setDeleting(t)}><Trash2 className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
      <TemplateEditorDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} initial={editing ?? undefined} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this template?"
        description={deleting ? `“${deleting.name}” will be removed. Messages you already wrote with it are not affected.` : undefined}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id, { onSuccess: () => { toast("Template deleted"); setDeleting(null); }, onError: (e) => toast.error(errorMessage(e)) })}
      />
    </section>
  );
}
