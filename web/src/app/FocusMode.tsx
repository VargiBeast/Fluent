import { Target } from "lucide-react";
import { FOCUS_CHOICES } from "@shared/focus";
import { FOCUS_LABELS, focusUntilLabel, useFocusMode } from "@/lib/focus";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/Menu";

/** Shown above every page while focus mode is on, with a one-click way out. */
export function FocusBanner() {
  const focus = useFocusMode();
  if (!focus.active || !focus.until) return null;
  return (
    <div role="region" aria-label="Focus mode" className="flex items-center gap-3 border-b border-line bg-accent-soft px-4 py-2 text-[13px] text-fg">
      <Target className="size-4 shrink-0 text-accent-ink" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Focus mode is on</span>
        <span className="text-fg-2"> · Only important mail is shown in your inbox, and new-mail alerts are paused {focusUntilLabel(focus.until)}.</span>
      </p>
      <button type="button" onClick={focus.stop} className="shrink-0 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium text-fg hover:bg-surface-2">
        Exit focus mode
      </button>
    </div>
  );
}

/** Sidebar entry to start focus mode for a chosen period. */
export function FocusMenu({ className }: { className: string }) {
  const focus = useFocusMode();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className={className}>
          <Target className="size-4" aria-hidden />
          <span className="flex-1 text-left">Focus mode</span>
          {focus.active && focus.until && <span className="text-[11px] text-accent-ink">{focusUntilLabel(focus.until)}</span>}
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Only important mail</MenuLabel>
        {FOCUS_CHOICES.map((c) => <MenuItem key={c} onSelect={() => focus.start(c)}>{FOCUS_LABELS[c]}</MenuItem>)}
        {focus.active && <MenuItem onSelect={focus.stop}>Exit focus mode</MenuItem>}
      </MenuContent>
    </Menu>
  );
}
