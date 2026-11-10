import { useEffect, useState } from "react";
import { focusEndsAt, isFocusActive, type FocusChoice } from "@shared/focus";
import { useSession } from "./session";
import { effectiveTimeZone, prefs } from "./prefs";
import { useUpdateSettings } from "./settings";

export const FOCUS_LABELS: Record<FocusChoice, string> = { "30m": "For 30 minutes", "1h": "For 1 hour", tomorrow: "Until tomorrow morning" };

export function userTimeZone(): string {
  return effectiveTimeZone();
}

/** "until 15:30" today, "until tomorrow 08:00" otherwise, in the user's time zone. */
export function focusUntilLabel(until: Date, now = new Date()): string {
  const time = until.toLocaleTimeString(prefs.locale, { hour: "2-digit", minute: "2-digit", timeZone: prefs.timeZone });
  return until.toDateString() === now.toDateString() ? `until ${time}` : `until tomorrow ${time}`;
}

/** Focus mode state from the per-user settings; flips off by itself when the period ends. */
export function useFocusMode() {
  const { session } = useSession();
  const update = useUpdateSettings();
  const until = session?.settings?.focus?.until ?? null;
  const [now, setNow] = useState(() => Date.now());
  const active = isFocusActive(until, now);
  useEffect(() => {
    if (!until || !active) return;
    const ms = Math.min(Date.parse(until) - Date.now() + 50, 2 ** 31 - 1);
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(ms, 0));
    return () => window.clearTimeout(id);
  }, [until, active]);
  return {
    active,
    until: active && until ? new Date(until) : null,
    start: (choice: FocusChoice) => {
      setNow(Date.now());
      update.mutate({ focus: { until: focusEndsAt(choice, new Date(), userTimeZone()).toISOString() } });
    },
    stop: () => update.mutate({ focus: { until: null } }),
  };
}
