import * as DM from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-[200px] rounded-xl border border-line-strong bg-surface p-1 shadow-[var(--shadow)] animate-in", className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ children, onSelect, icon, danger, disabled }: { children: ReactNode; onSelect: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40",
        danger ? "text-danger" : "text-fg-2 data-[highlighted]:text-fg",
      )}
    >
      {icon && <span className="text-fg-3 [&_svg]:size-4">{icon}</span>}
      {children}
    </DM.Item>
  );
}

export function MenuCheckbox({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <DM.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-2 outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg"
    >
      <span className={cn("flex size-4 items-center justify-center rounded border", checked ? "border-accent bg-accent text-white" : "border-line-strong")}>
        {checked && <svg viewBox="0 0 12 12" className="size-3" aria-hidden><path d="M2.5 6.5l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>}
      </span>
      {children}
    </DM.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-3">{children}</DM.Label>;
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-line" />;
}
