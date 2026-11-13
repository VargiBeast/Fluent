import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";

const controlBase =
  "w-full rounded-[var(--radius-md)] border border-line bg-surface-2 text-fg placeholder:text-fg-3 outline-none " +
  "transition-[border-color,box-shadow,background] duration-[var(--duration-fast)] ease-[var(--ease-out)] " +
  "hover:border-line-strong " +
  "focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(controlBase, "h-9 px-3 text-[13.5px]", className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(controlBase, "min-h-[80px] px-3 py-2 text-[13.5px] leading-relaxed", className)}
      {...rest}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg-2">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p id={hintId} role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[12px] text-fg-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div>
        <label htmlFor={id} className="text-[13.5px] font-medium text-fg">
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-[12px] text-fg-3">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--duration-fast)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-accent" : "bg-surface-3",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            checked && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}
