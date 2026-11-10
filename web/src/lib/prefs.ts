/**
 * Per-user preferences that plain (non-React) code needs: date formatting and single-key shortcuts.
 * AppLayout copies them from the settings record whenever it changes.
 */
export const prefs = {
  locale: undefined as string | undefined,
  timeZone: undefined as string | undefined,
  shortcuts: true,
};

export function setPrefs(p: { language: string; timeZone: string; shortcuts: boolean }) {
  prefs.locale = p.language === "auto" ? undefined : p.language;
  prefs.timeZone = p.timeZone === "auto" ? undefined : p.timeZone;
  prefs.shortcuts = p.shortcuts;
}

/** The time zone in effect: the one chosen in Settings, else the device's. */
export function effectiveTimeZone(): string {
  if (prefs.timeZone) return prefs.timeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The language in effect for dates and the daily brief. */
export function effectiveLanguage(): string {
  return (prefs.locale ?? (typeof navigator !== "undefined" ? navigator.language : "") ?? "en").slice(0, 24) || "en";
}

/** True when single-key shortcuts are turned off and this key press has no modifier, so handlers should ignore it. */
export function singleKeysOff(e: KeyboardEvent): boolean {
  return !prefs.shortcuts && !e.metaKey && !e.ctrlKey && !e.altKey;
}
