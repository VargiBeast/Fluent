import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Clock, X } from "lucide-react";
import { toast } from "sonner";
import type { ThreadDetail } from "@shared/mail";
import { api, errorMessage } from "@/lib/api";
import { formatDue, snoozePresets, type SnoozeRow } from "@/lib/snooze";
import { IconButton } from "@/components/ui/Button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/Menu";

export function useSnoozes() {
  return useQuery({ queryKey: ["snoozes"], queryFn: () => api.get<{ snoozes: SnoozeRow[] }>("/mail/snoozes"), staleTime: 30_000 });
}

export function SnoozeMenu({ thread, onSnoozed }: { thread: ThreadDetail; onSnoozed?: () => void }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (p: { until: Date; kind: "snooze" | "remind" }) => api.post<SnoozeRow>("/mail/snoozes", { accountId: thread.accountId, threadId: thread.id, until: p.until.toISOString(), kind: p.kind }),
    onSuccess: (r) => {
      for (const k of ["snoozes", "threads", "thread", "labels"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success(r.kind === "snooze" ? `Snoozed until ${formatDue(r.dueAt)}` : `I'll remind you ${formatDue(r.dueAt)} if nobody replies`);
      if (r.kind === "snooze") onSnoozed?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const presets = snoozePresets();
  const in3 = new Date(Date.now() + 3 * 86400_000);
  in3.setHours(9, 0, 0, 0);
  const in7 = new Date(Date.now() + 7 * 86400_000);
  in7.setHours(9, 0, 0, 0);
  return (
    <Menu>
      <MenuTrigger asChild><IconButton label="Snooze or remind (z)" data-snooze-trigger=""><Clock className="size-[18px]" /></IconButton></MenuTrigger>
      <MenuContent>
        <MenuLabel>Snooze until…</MenuLabel>
        {presets.map((p) => (
          <MenuItem key={p.id} icon={<Clock />} onSelect={() => set.mutate({ until: p.until, kind: "snooze" })}>
            <span className="flex-1">{p.label}</span><span className="ml-4 text-[11.5px] text-fg-3">{formatDue(p.until.toISOString())}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>Remind me if no reply</MenuLabel>
        <MenuItem icon={<BellRing />} onSelect={() => set.mutate({ until: in3, kind: "remind" })}>In 3 days</MenuItem>
        <MenuItem icon={<BellRing />} onSelect={() => set.mutate({ until: in7, kind: "remind" })}>In a week</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function SnoozeBanner({ thread }: { thread: ThreadDetail }) {
  const qc = useQueryClient();
  const q = useSnoozes();
  const row = q.data?.snoozes.find((s) => s.accountId === thread.accountId && s.threadId === thread.id);
  const cancel = useMutation({
    mutationFn: () => api.del(`/mail/snoozes/${thread.accountId}/${thread.id}`),
    onSuccess: () => {
      for (const k of ["snoozes", "threads", "thread", "labels"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success(row?.kind === "snooze" ? "Back in your Inbox" : "Reminder removed");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!row) return null;
  return (
    <div role="status" className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2 animate-in">
      {row.kind === "snooze" ? <Clock className="size-3.5 text-accent-400" /> : <BellRing className="size-3.5 text-accent-400" />}
      <span className="flex-1">{row.kind === "snooze" ? `Snoozed until ${formatDue(row.dueAt)}` : `Reminder ${formatDue(row.dueAt)} if nobody replies`}</span>
      <button type="button" onClick={() => cancel.mutate()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-fg-3 hover:bg-surface-3 hover:text-fg">
        <X className="size-3" /> {row.kind === "snooze" ? "Unsnooze" : "Cancel reminder"}
      </button>
    </div>
  );
}
