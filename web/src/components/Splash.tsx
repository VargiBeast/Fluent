import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/misc";

export function Splash() {
  return (
    <div className="flex h-full min-h-dvh flex-col items-center justify-center gap-4 bg-bg" aria-busy="true">
      <Logo />
      <Loader2 className="size-5 animate-spin text-fg-3" aria-label="Loading" />
    </div>
  );
}
