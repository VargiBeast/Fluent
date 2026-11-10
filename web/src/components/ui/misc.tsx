import { useId, type ReactNode } from "react";
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
      <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">{icon}</div>
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

const LOGO_BODY = "M 30 45 H 98 Q 112 45 112 59 V 89 Q 112 103 98 103 H 30 Q 16 103 16 89 V 59 Q 16 45 30 45 Z";
const LOGO_FLAP = "M 16 49 L 64 85 L 112 49 V 35 C 112 28 107 25 100 25 H 28 C 21 25 16 28 16 35 Z";
const LOGO_SPARK = "M 102.00 10.00 L 107.66 24.34 L 122.00 30.00 L 107.66 35.66 L 102.00 50.00 L 96.34 35.66 L 82.00 30.00 L 96.34 24.34 Z";
const LOGO_HALO_DARK = "M 102.00 8.00 L 108.22 23.78 L 124.00 30.00 L 108.22 36.22 L 102.00 52.00 L 95.78 36.22 L 80.00 30.00 L 95.78 23.78 Z";
const LOGO_HALO_LIGHT = "M 102.00 7.60 L 108.34 23.66 L 124.40 30.00 L 108.34 36.34 L 102.00 52.40 L 95.66 36.34 L 79.60 30.00 L 95.66 23.66 Z";

function LogoMark({ variant, id }: { variant: "dark" | "light"; id: string }) {
  const tile = variant === "dark" ? "#141418" : "#FFFFFF";
  const flap = variant === "dark" ? "#E4DCFF" : "#C9B8FF";
  const stroke = variant === "dark" ? "#B45309" : "#8A5808";
  const halo = variant === "dark" ? "#141418" : "#FFFFFF";
  const haloPath = variant === "dark" ? LOGO_HALO_DARK : LOGO_HALO_LIGHT;
  const gId = `${id}-g`;
  const sId = `${id}-s`;
  return (
    <>
      <rect width="128" height="128" rx="28" fill={tile} stroke={variant === "light" ? "#E6E0F5" : undefined} strokeWidth={variant === "light" ? 2 : undefined} />
      <g clipPath={`url(#${id}-clip)`}>
        <path d={LOGO_BODY} fill={`url(#${gId})`} />
        <path d={LOGO_FLAP} fill={flap} />
        <path d={haloPath} fill={halo} />
        <path d={LOGO_SPARK} fill={`url(#${sId})`} stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
      </g>
    </>
  );
}

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  const rawId = useId().replace(/:/g, "");
  const darkId = `${rawId}d`;
  const lightId = `${rawId}l`;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 128 128" className="size-7" aria-hidden>
        <defs>
          <clipPath id={`${darkId}-clip`}><rect width="128" height="128" rx="28" /></clipPath>
          <clipPath id={`${lightId}-clip`}><rect width="128" height="128" rx="28" /></clipPath>
          <linearGradient id={`${darkId}-g`} x1="16" y1="24" x2="112" y2="102" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#C4B5FD" />
            <stop offset="0.45" stopColor="#7C5CFF" />
            <stop offset="1" stopColor="#5B21B6" />
          </linearGradient>
          <linearGradient id={`${lightId}-g`} x1="16" y1="24" x2="112" y2="102" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#C4B5FD" />
            <stop offset="0.45" stopColor="#7C5CFF" />
            <stop offset="1" stopColor="#5B21B6" />
          </linearGradient>
          <radialGradient id={`${darkId}-s`} cx="102" cy="30" r="20" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFE9A8" />
            <stop offset="0.55" stopColor="#FFC857" />
            <stop offset="1" stopColor="#E8A317" />
          </radialGradient>
          <radialGradient id={`${lightId}-s`} cx="102" cy="30" r="20" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFE9A8" />
            <stop offset="0.55" stopColor="#FFC857" />
            <stop offset="1" stopColor="#E8A317" />
          </radialGradient>
        </defs>
        <g className="hidden dark:block">
          <LogoMark variant="dark" id={darkId} />
        </g>
        <g className="dark:hidden">
          <LogoMark variant="light" id={lightId} />
        </g>
      </svg>
      {withText && <span className="text-[15px] font-semibold tracking-[0.18em] text-fg">FLUENT</span>}
    </span>
  );
}
