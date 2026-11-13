import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] animate-in" />
        <RD.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2",
            "overflow-auto rounded-[var(--radius-xl)] border border-line-strong bg-surface p-5",
            "shadow-[var(--shadow-lg)] animate-scale-in scroll-thin",
            wide ? "max-w-2xl" : "max-w-md",
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <RD.Title className="text-[16px] font-semibold tracking-tight text-fg">{title}</RD.Title>
              {description ? (
                <RD.Description className="mt-1 text-[13px] leading-relaxed text-fg-3">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{title}</RD.Description>
              )}
            </div>
            <RD.Close
              className={cn(
                "shrink-0 rounded-[var(--radius-sm)] p-1.5 text-fg-3",
                "transition-colors duration-[var(--duration-fast)]",
                "hover:bg-surface-2 hover:text-fg",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]",
              )}
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </RD.Close>
          </div>
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  loading,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {children}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
