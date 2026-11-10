import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, useId } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-[10px] border border-line bg-surface-2 px-3 text-[13.5px] text-fg placeholder:text-fg-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]",
        className,
      )}
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
      className={cn(
        "w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-fg placeholder:text-fg-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]",
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg-2">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-fg-3">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div>
        <label htmlFor={id} className="text-[13.5px] font-medium text-fg">{label}</label>
        {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-accent" : "bg-surface-3",
        )}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform", checked && "translate-x-4")} />
      </button>
    </div>
  );
}
