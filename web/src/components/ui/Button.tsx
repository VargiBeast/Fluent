import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ai";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-[0_6px_20px_-8px_var(--accent)] hover:brightness-110 active:brightness-95",
  secondary:
    "bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong active:bg-surface-3",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg active:bg-surface-3",
  danger: "bg-danger/90 text-white hover:bg-danger active:brightness-95",
  ai: "bg-accent-soft text-ai-title border border-[var(--ai-border)] hover:brightness-125 active:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[var(--radius-sm)]",
  md: "h-9 px-3.5 text-[13.5px] gap-2 rounded-[var(--radius-md)]",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-[var(--radius-lg)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium whitespace-nowrap",
        "transition-[background,filter,color,transform,border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required for icon-only controls. */
  label: string;
  active?: boolean;
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, size = "md", className, children, type = "button", disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-fg-3",
        "transition-[background,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-2 hover:text-fg active:scale-95",
        "disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]",
        size === "md" ? "size-9" : "size-7",
        active && "bg-accent-soft text-accent-ink hover:text-accent-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
