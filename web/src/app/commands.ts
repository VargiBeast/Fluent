/** Pure command registry + fuzzy filter for the ⌘K palette (kept separate so it can be unit-tested). */
export interface Command {
  id: string;
  title: string;
  group: "Copilot" | "Go to" | "Actions" | "Conversation" | "Settings";
  keywords?: string;
  shortcut?: string;
}

/** Subsequence match with a score: contiguous and word-start matches rank higher. */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return 100 - idx + (idx === 0 || t[idx - 1] === " " ? 50 : 0);
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    score += found === ti ? 3 : 1;
    ti = found + 1;
  }
  return score;
}

export function filterCommands<T extends Command>(commands: T[], query: string): T[] {
  if (!query.trim()) return commands;
  return commands
    .map((c) => ({ c, s: Math.max(matchScore(query, c.title), matchScore(query, c.keywords ?? "") * 0.8) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}
