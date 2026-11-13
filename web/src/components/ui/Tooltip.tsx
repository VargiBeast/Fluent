import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Compact tooltip for icon-only controls.
 * Requires Tooltip.Provider (already mounted in main.tsx).
 */
export function Tooltip({
  content,
  children,
  side = "bottom",
  delayDuration,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}) {
  if (content == null || content === "") return <>{children}</>;
  return (
    <T.Root delayDuration={delayDuration}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[60] max-w-xs rounded-[var(--radius-sm)] border border-line-strong bg-surface px-2.5 py-1.5",
            "text-[12px] leading-snug text-fg shadow-[var(--shadow-md)] animate-scale-in",
          )}
        >
          {content}
          <T.Arrow className="fill-surface" width={10} height={5} />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
