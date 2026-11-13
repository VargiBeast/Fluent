import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Filter, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import type { GmailLabel } from "@shared/mail";
import { api, errorMessage, qs } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLabels } from "@/lib/mail";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/misc";
import { CreateLabelDialog } from "../Sidebar";

interface GmailFilter {
  id: string;
  criteria?: { from?: string; to?: string; subject?: string; query?: string; hasAttachment?: boolean };
  action?: { addLabelIds?: string[]; removeLabelIds?: string[] };
}

export function LabelsFiltersSection() {
  const { session } = useSession();
  const accounts = (session?.accounts ?? []).filter((a) => a.status === "active");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  if (!accounts.length) return <p className="text-[13px] text-fg-3">Connect a Gmail account to manage labels and filters.</p>;
  return (
    <>
      {accounts.length > 1 && (
        <div className="flex items-center gap-3">
          <label htmlFor="lf-account" className="text-[13px] text-fg-2">Account</label>
          <select id="lf-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-fg">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
        </div>
      )}
      <LabelsPanel accountId={accountId} />
      <FiltersPanel accountId={accountId} />
    </>
  );
}

function Panel({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[14.5px] font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-fg-3">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="px-5 py-3">{children}</div>
    </section>
  );
}

function useAccountLabels(accountId: string) {
  const q = useLabels(accountId);
  const labels = q.data?.accounts.find((a) => a.accountId === accountId)?.labels ?? [];
  return { q, labels, user: labels.filter((l) => l.type === "user").sort((a, b) => a.name.localeCompare(b.name)) };
}

function LabelsPanel({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const { q, user } = useAccountLabels(accountId);
  const [create, setCreate] = useState(false);
  const [rename, setRename] = useState<GmailLabel | null>(null);
  const [name, setName] = useState("");
  const [remove, setRemove] = useState<GmailLabel | null>(null);
  const done = () => { void qc.invalidateQueries({ queryKey: ["labels"] }); void qc.invalidateQueries({ queryKey: ["threads"] }); };
  const renameM = useMutation({ mutationFn: () => api.patch(`/mail/labels/${accountId}/${rename!.id}`, { name: name.trim() }), onSuccess: () => { toast.success("Label renamed"); setRename(null); done(); }, onError: (e) => toast.error(errorMessage(e)) });
  const removeM = useMutation({ mutationFn: () => api.del(`/mail/labels/${accountId}/${remove!.id}`), onSuccess: () => { toast.success("Label deleted"); setRemove(null); done(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Panel title="Labels" description="Labels are Gmail labels — changes apply to Gmail everywhere." actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreate(true)}>New label</Button>}>
      {q.isLoading ? <Skeleton className="my-2 h-20 w-full" /> : q.isError ? <p className="py-3 text-[13px] text-danger">{errorMessage(q.error)}</p> : user.length === 0 ? <p className="py-4 text-[13px] text-fg-3">No labels yet.</p> : (
        <ul className="divide-y divide-line" aria-label="Labels">
          {user.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2">
              <Tag className="size-4 shrink-0" style={{ color: l.color?.backgroundColor ?? "var(--text-3)" }} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{l.name}</span>
              <IconButton size="sm" label={`Rename ${l.name}`} onClick={() => { setRename(l); setName(l.name); }}><Pencil className="size-3.5" /></IconButton>
              <IconButton size="sm" label={`Delete ${l.name}`} onClick={() => setRemove(l)}><Trash2 className="size-3.5" /></IconButton>
            </li>
          ))}
        </ul>
      )}
      <CreateLabelDialog open={create} onOpenChange={setCreate} defaultAccount={accountId} />
      <Dialog open={Boolean(rename)} onOpenChange={(o) => !o && setRename(null)} title="Rename label">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) renameM.mutate(); }}>
          <Field label="Name">{(id) => <Input id={id} value={name} maxLength={225} autoFocus onChange={(e) => setName(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setRename(null)}>Cancel</Button><Button type="submit" variant="primary" loading={renameM.isPending} disabled={!name.trim()}>Save</Button></div>
        </form>
      </Dialog>
      <ConfirmDialog open={Boolean(remove)} onOpenChange={(o) => !o && setRemove(null)} title={`Delete “${remove?.name ?? ""}”?`} description="The label is removed from Gmail. Conversations with this label are not deleted." confirmLabel="Delete label" danger loading={removeM.isPending} onConfirm={() => removeM.mutate()} />
    </Panel>
  );
}

function FiltersPanel({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const { labels, user } = useAccountLabels(accountId);
  const filters = useQuery({ queryKey: ["filters", accountId], queryFn: () => api.get<{ filters: GmailFilter[] }>(`/mail/filters${qs({ account: accountId })}`), enabled: Boolean(accountId), retry: false });
  const [open, setOpen] = useState(false);
  const [remove, setRemove] = useState<GmailFilter | null>(null);
  const [form, setForm] = useState({ from: "", subject: "", query: "", hasAttachment: false, label: "", skipInbox: false, markRead: false });
  const labelName = (id: string) => labels.find((l) => l.id === id)?.name ?? id;
  const createM = useMutation({
    mutationFn: () => api.post("/mail/filters", {
      accountId,
      criteria: { ...(form.from && { from: form.from.trim() }), ...(form.subject && { subject: form.subject.trim() }), ...(form.query && { query: form.query.trim() }), ...(form.hasAttachment && { hasAttachment: true }) },
      action: { ...(form.label && { addLabelIds: [form.label] }), ...((form.skipInbox || form.markRead) && { removeLabelIds: [...(form.skipInbox ? ["INBOX"] : []), ...(form.markRead ? ["UNREAD"] : [])] }) },
    }),
    onSuccess: () => { toast.success("Filter created in Gmail"); setOpen(false); setForm({ from: "", subject: "", query: "", hasAttachment: false, label: "", skipInbox: false, markRead: false }); void qc.invalidateQueries({ queryKey: ["filters", accountId] }); },
    onError: (e) => toast.error("Couldn't create filter", { description: errorMessage(e) }),
  });
  const removeM = useMutation({ mutationFn: () => api.del(`/mail/filters/${accountId}/${remove!.id}`), onSuccess: () => { toast.success("Filter deleted"); setRemove(null); void qc.invalidateQueries({ queryKey: ["filters", accountId] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const hasCriteria = Boolean(form.from.trim() || form.subject.trim() || form.query.trim() || form.hasAttachment);
  const hasAction = Boolean(form.label || form.skipInbox || form.markRead);
  const describe = (f: GmailFilter) => {
    const c = f.criteria ?? {};
    const when = [c.from && `from ${c.from}`, c.to && `to ${c.to}`, c.subject && `subject “${c.subject}”`, c.query && `matches “${c.query}”`, c.hasAttachment && "has attachment"].filter(Boolean).join(", ");
    const a = f.action ?? {};
    const then = [...(a.addLabelIds ?? []).map((l) => `label “${labelName(l)}”`), a.removeLabelIds?.includes("INBOX") && "skip inbox", a.removeLabelIds?.includes("UNREAD") && "mark as read", a.removeLabelIds?.includes("IMPORTANT") && "never important"].filter(Boolean).join(", ");
    return { when: when || "any message", then: then || "no action" };
  };
  return (
    <Panel title="Filters" description="Gmail filters run on new mail, even when MailIQ isn't open." actions={<Button size="sm" icon={<Filter className="size-3.5" />} onClick={() => setOpen(true)}>New filter</Button>}>
      {filters.isLoading ? <Skeleton className="my-2 h-16 w-full" /> : filters.isError ? <p className="py-3 text-[13px] text-danger">{errorMessage(filters.error)}</p> : !filters.data?.filters.length ? <p className="py-4 text-[13px] text-fg-3">No filters yet.</p> : (
        <ul className="divide-y divide-line" aria-label="Filters">
          {filters.data.filters.map((f) => {
            const d = describe(f);
            return (
              <li key={f.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1 text-[13px]">
                  <p className="truncate text-fg"><span className="text-fg-3">When</span> {d.when}</p>
                  <p className="truncate text-fg-2"><span className="text-fg-3">Then</span> {d.then}</p>
                </div>
                <IconButton size="sm" label="Delete filter" onClick={() => setRemove(f)}><Trash2 className="size-3.5" /></IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="New filter" description="Choose which messages to match and what Gmail should do with them.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (hasCriteria && hasAction) createM.mutate(); }}>
          <Field label="From">{(id) => <Input id={id} value={form.from} maxLength={254} placeholder="newsletter@example.com" onChange={(e) => setForm({ ...form, from: e.target.value })} />}</Field>
          <Field label="Subject contains">{(id) => <Input id={id} value={form.subject} maxLength={200} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}</Field>
          <Field label="Has the words">{(id) => <Input id={id} value={form.query} maxLength={300} onChange={(e) => setForm({ ...form, query: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-[13px] text-fg"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.hasAttachment} onChange={(e) => setForm({ ...form, hasAttachment: e.target.checked })} /> Has attachment</label>
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-[13px] font-medium text-fg-2">Then</p>
            <label htmlFor="filter-label" className="sr-only">Apply label</label>
            <select id="filter-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-fg">
              <option value="">Don't apply a label</option>
              {user.map((l) => <option key={l.id} value={l.id}>Apply label “{l.name}”</option>)}
            </select>
            <div className="mt-2 space-y-1.5">
              <label className="flex items-center gap-2 text-[13px] text-fg"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.skipInbox} onChange={(e) => setForm({ ...form, skipInbox: e.target.checked })} /> Skip the inbox (archive)</label>
              <label className="flex items-center gap-2 text-[13px] text-fg"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.markRead} onChange={(e) => setForm({ ...form, markRead: e.target.checked })} /> Mark as read</label>
            </div>
          </div>
          {(!hasCriteria || !hasAction) && <p className="text-xs text-fg-3">Add at least one condition and one action.</p>}
          <div className="flex justify-end gap-2 pt-1"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={!hasCriteria || !hasAction} loading={createM.isPending}>Create filter</Button></div>
        </form>
      </Dialog>
      <ConfirmDialog open={Boolean(remove)} onOpenChange={(o) => !o && setRemove(null)} title="Delete this filter?" description="Gmail will stop applying it to new mail." confirmLabel="Delete filter" danger loading={removeM.isPending} onConfirm={() => removeM.mutate()} />
    </Panel>
  );
}
