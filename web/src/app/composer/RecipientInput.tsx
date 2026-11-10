import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { EMAIL_RE, splitAddresses } from "@/lib/compose";

export function RecipientInput({ label, values, onChange, autoFocus, id }: { label: string; values: string[]; onChange: (v: string[]) => void; autoFocus?: boolean; id: string }) {
  const [text, setText] = useState("");
  const commit = (raw = text) => {
    const parts = splitAddresses(raw);
    if (!parts.length) return;
    onChange([...values, ...parts.filter((p) => !values.includes(p))]);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
      if (text.trim()) {
        if (e.key !== "Tab") e.preventDefault();
        commit();
      }
    } else if (e.key === "Backspace" && !text && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div className="flex min-h-10 items-center gap-2 border-b border-line px-4 py-1">
      <label htmlFor={id} className="w-14 shrink-0 text-[13px] text-fg-3">{label}</label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {values.map((v) => {
          const ok = EMAIL_RE.test(v);
          return (
            <span key={v} className={cn("inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-[12.5px]", ok ? "bg-surface-3 text-fg" : "bg-danger/15 text-danger")} title={ok ? v : "Invalid address"}>
              <span className="truncate">{v}</span>
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-fg-3 hover:text-fg"><X className="size-3" /></button>
            </span>
          );
        })}
        <input
          id={id}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => commit()}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[,;\n]/.test(t)) {
              e.preventDefault();
              commit(t);
            }
          }}
          className="h-8 min-w-[140px] flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-3"
          placeholder={values.length ? "" : "name@example.com"}
          autoComplete="email"
          inputMode="email"
        />
      </div>
    </div>
  );
}
