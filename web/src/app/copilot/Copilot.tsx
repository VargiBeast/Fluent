import * as RD from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive, Check, ChevronDown, ChevronUp, Loader2, Send, Sparkles, Undo2, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Kbd } from "@/components/ui/misc";
import type { ActionResult, CopilotActionType, CopilotReply, ExecuteResult, PlanAction, PlanPreview } from "@shared/copilot";
import type { ThreadSummary } from "@shared/mail";
import { useSession } from "@/lib/session";
import { useCopilot } from "./context";
import { CopilotMic } from "../voice/CopilotMic";

/** The app-wide Copilot panel. Mounted once in the app shell; opened with buttons or ⌘K / Ctrl+K. */
export function CopilotHost() {
  const { isOpen, setOpen, prefill } = useCopilot();
  const context = undefined; // simplified for restore
  return <CopilotPanel open={isOpen} onOpenChange={setOpen} context={context} prefill={prefill} />;
}

export function CopilotPanel({ open, onOpenChange, context, prefill }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context?: unknown;
  prefill?: string;
}) {
  const { config } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState(prefill ?? "");

  useEffect(() => {
    if (prefill) setMessage(prefill);
  }, [prefill]);

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RD.Content
          className={cn(
            "fixed z-50 flex flex-col border border-line bg-surface shadow-2xl outline-none",
            expanded
              ? "inset-4 max-h-[calc(100%-2rem)] rounded-2xl sm:inset-x-[12%] sm:inset-y-8"
              : "bottom-0 right-0 top-0 w-full max-w-md border-l sm:rounded-l-2xl",
          )}
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Sparkles className="size-4 text-accent-ink" />
            <RD.Title className="text-[14.5px] font-semibold text-fg">MailIQ Copilot</RD.Title>
            <span className="hidden text-[11px] text-fg-3 sm:inline" title="Toggle Copilot"><Kbd>⌘J</Kbd></span>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2 hidden sm:inline-flex" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? "Dock to the side" : "Expand Copilot"}>
                {expanded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
              </button>
              <RD.Close className="rounded-md p-1.5 text-fg-3 hover:bg-surface-2" aria-label="Close">
                <X className="size-4" />
              </RD.Close>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!config?.ai ? (
              <p className="text-[13px] text-fg-3">AI isn’t configured on this server. Add an AI provider key (see docs/SETUP.md) to use Copilot.</p>
            ) : (
              <p className="text-[13px] text-fg-3">Ask MailIQ Copilot about your inbox or give it an instruction.</p>
            )}
          </div>
          <div className="border-t border-line p-3">
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[13.5px] outline-none focus:border-accent"
                placeholder="Ask or instruct Copilot"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-label="Ask or instruct Copilot"
              />
              <button type="button" className="rounded-xl bg-accent px-3 py-2 text-accent-fg" aria-label="Send to Copilot">
                <Send className="size-4" />
              </button>
            </div>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
