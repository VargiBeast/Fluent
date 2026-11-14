import { Logo } from "@/components/ui/misc";

export function Splash() {
  return (
    <div className="flex min-h-full items-center justify-center animate-in">
      <Logo withText className="opacity-80 animate-pulse-soft" />
    </div>
  );
}
