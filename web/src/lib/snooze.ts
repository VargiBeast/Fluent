export interface SnoozeRow { accountId: string; threadId: string; kind: "snooze" | "remind"; dueAt: string }

const at = (d: Date, h: number) => {
  const x = new Date(d);
  x.setHours(h, 0, 0, 0);
  return x;
};

/** Preset times in the user's local zone. */
export function snoozePresets(now = new Date()): Array<{ id: string; label: string; until: Date }> {
  const laterToday = new Date(now.getTime() + 3 * 3600_000);
  laterToday.setMinutes(0, 0, 0);
  const tomorrow = at(new Date(now.getTime() + 86400_000), 8);
  const thisWeekend = at(new Date(now.getTime() + ((6 - now.getDay() + 7) % 7 || 7) * 86400_000), 9);
  const nextWeek = at(new Date(now.getTime() + ((8 - now.getDay()) % 7 || 7) * 86400_000), 8);
  const out = [
    { id: "later", label: "Later today", until: laterToday },
    { id: "tomorrow", label: "Tomorrow", until: tomorrow },
    { id: "weekend", label: "This weekend", until: thisWeekend },
    { id: "nextweek", label: "Next week", until: nextWeek },
  ];
  // "Later today" only makes sense before the evening.
  return out.filter((p) => p.id !== "later" || laterToday.getDate() === now.getDate());
}

export function formatDue(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}
