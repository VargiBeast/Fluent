import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Chip({
  active,
  children,
  onClick,
  className,
  count,
}: {
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
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]",
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-line bg-surface-2 text-fg-2 hover:border-line-strong hover:bg-surface-3 hover:text-fg",
        className,
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className="text-[11px] opacity-80">{count}</span>}
    </button>
  );
}

export function Badge({
  children,
  tone = "accent",
  className,
}: {
  children: ReactNode;
  tone?: "accent" | "danger" | "muted";
  className?: string;
}) {
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
  return <div aria-hidden className={cn("shimmer rounded-[var(--radius-sm)]", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-fg-3">
      {children}
    </kbd>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-16 text-center animate-in">
      <div className="flex size-12 items-center justify-center rounded-[var(--radius-xl)] bg-accent-soft text-accent-ink">
        {icon}
      </div>
      <div>
        <p className="text-[15px] font-semibold tracking-tight text-fg">{title}</p>
        {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-fg-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** MailIQ lettermark: bold M on purple tile (OAuth + app icon). */
function LogoMark() {
  return (
    <>
      <rect width="128" height="128" rx="32" fill="#7C3AED" />
      <path
        d="M22 98V30h18.5l23.5 48.5L87.5 30H106v68H91.5V52.5L72 92H56L36.5 52.5V98H22z"
        fill="#FFFFFF"
      />
    </>
  );
}

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  const rawId = useId().replace(/:/g, "");
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 128 128" className="size-7" aria-hidden data-logo-id={rawId}>
        <LogoMark />
      </svg>
      {withText && <span className="text-[15px] font-semibold tracking-[0.18em] text-fg">MailIQ</span>}
    </span>
  );
}
