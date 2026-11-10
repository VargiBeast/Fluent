import { z } from "zod";

/** Focus mode periods offered in the UI. "tomorrow" ends at FOCUS_MORNING_HOUR the next day, in the user's time zone. */
export const FOCUS_CHOICES = ["30m", "1h", "tomorrow"] as const;
export type FocusChoice = (typeof FOCUS_CHOICES)[number];
export const FOCUS_MORNING_HOUR = 8;
/** Longest focus period the server accepts (until-tomorrow started just after midnight is ~32 h). */
export const FOCUS_MAX_MS = 36 * 3600_000;

/** A focus end time must be null (focus off) or a future instant no more than FOCUS_MAX_MS away. */
export const focusUntilSchema = z.string().datetime({ offset: true }).nullable().refine((v) => {
  if (v === null) return true;
  const t = Date.parse(v);
  const now = Date.now();
  return t > now - 60_000 && t <= now + FOCUS_MAX_MS + 60_000;
}, "Focus must end within the next 36 hours");

/** Offset (ms) of `timeZone` from UTC at instant `t`. */
function tzOffset(t: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(t)).map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - Math.floor(t / 1000) * 1000;
}

/** When a focus period chosen now should end. */
export function focusEndsAt(choice: FocusChoice, now: Date, timeZone: string): Date {
  if (choice === "30m") return new Date(now.getTime() + 30 * 60_000);
  if (choice === "1h") return new Date(now.getTime() + 3600_000);
  const local = new Date(now.getTime() + tzOffset(now.getTime(), timeZone));
  const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, FOCUS_MORNING_HOUR);
  let t = wall - tzOffset(wall, timeZone);
  t = wall - tzOffset(t, timeZone); // re-check the offset at the result, for days with a DST change
  return new Date(t);
}

export function isFocusActive(until: string | null | undefined, now = Date.now()): boolean {
  return Boolean(until) && Date.parse(until!) > now;
}
