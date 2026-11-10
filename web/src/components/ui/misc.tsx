import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Chip({ active, children, onClick, className, count }: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
        active ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface-2 text-fg-2 hover:text-fg hover:bg-surface-3",
        className,
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className="text-[11px] opacity-80">{count}</span>}
    </button>
  );
}

export function Badge({ children, tone = "accent", className }: { children: ReactNode; tone?: "accent" | "danger" | "muted"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold",
        tone === "accent" && "bg-accent text-accent-fg",
        tone === "danger" && "bg-danger text-white",
        tone === "muted" && "bg-surface-3 text-fg-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer rounded-md", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-fg-3">{children}</kbd>;
}

export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-16 text-center animate-in">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-400">{icon}</div>
      <div>
        <p className="text-[15px] font-semibold text-fg">{title}</p>
        {description && <p className="mt-1 max-w-sm text-[13px] text-fg-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface p-5", className)}>{children}</div>;
}

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden>
        <defs>
          <linearGradient id="fl-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c4b5fd" />
            <stop offset="1" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="var(--surface-3)" />
        <path d="M20 18h26v7H28v6h15v7H28v10h-8z" fill="url(#fl-g)" />
      </svg>
      {withText && <span className="text-[15px] font-semibold tracking-[0.18em] text-fg">FLUENT</span>}
    </span>
  );
}
