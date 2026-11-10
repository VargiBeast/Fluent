import { useState } from "react";
import { cn } from "@/lib/cn";

const palette = ["#7c3aed", "#2563eb", "#0d9488", "#c026d3", "#d97706", "#db2777", "#4f46e5", "#059669"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.replace(/[<>"]/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({ name, email, src, size = 36, className }: {
  name: string;
  email?: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const color = palette[hash(email ?? name) % palette.length];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-line", className)}
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-white/10", className)}
      style={{ ...style, background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
    >
      {initials(name)}
    </span>
  );
}
