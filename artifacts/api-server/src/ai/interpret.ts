const ALLOWED_OPERATORS = new Set([
  "from",
  "to",
  "subject",
  "is",
  "has",
  "in",
  "label",
  "newer_than",
  "older_than",
  "after",
  "before",
  "category",
  "filename",
]);

export interface SearchInterpretation {
  understood: boolean;
  gmailQuery: string | null;
  explanation: string;
  exhaustive: false;
  method: "rules" | "model";
  mock: boolean;
}

export function assertSafeGmailQuery(query: string): string {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 256) {
    throw new Error("UNSAFE_QUERY");
  }
  if (/[{};`$\\<>]/.test(trimmed)) throw new Error("UNSAFE_QUERY");
  const parts = trimmed.match(/[a-z_]+:(?:"[^"]+"|\S+)|"[^"]+"|\S+/gi) ?? [];
  for (const part of parts) {
    const operator = /^([a-z_]+):/i.exec(part);
    if (operator && !ALLOWED_OPERATORS.has(operator[1].toLowerCase())) {
      throw new Error("UNSAFE_QUERY");
    }
  }
  return trimmed;
}

/**
 * Deterministic interpreter. It is not a language model.
 * Results are never described as exhaustive.
 */
export function interpretWithRules(input: string): SearchInterpretation {
  const text = input.trim().toLowerCase();
  if (!text || text.length > 400) {
    return notUnderstood("Enter a shorter search.");
  }
  const parts: string[] = [];
  const notes: string[] = [];
  const fromMatch = text.match(/\bfrom\s+(?:my\s+|the\s+)?([a-z0-9._@-]+)/i);
  if (fromMatch && !["emails", "email", "messages", "me"].includes(fromMatch[1])) {
    if (fromMatch[1] === "teacher" || fromMatch[1] === "faculty") parts.push("teacher");
    else parts.push(`from:${fromMatch[1]}`);
  }
  if (/\b(last month|past month)\b/.test(text)) parts.push("newer_than:40d");
  if (/\b(last week|past week)\b/.test(text)) parts.push("newer_than:7d");
  if (/\b(unread|not read)\b/.test(text)) parts.push("is:unread");
  if (/\bstarred\b/.test(text)) parts.push("is:starred");
  if (/\b(not answered|haven't answered|unanswered|needs a reply)\b/.test(text)) {
    parts.push("is:unread");
    parts.push("in:inbox");
    notes.push("Unanswered is approximated as unread mail still in the inbox.");
  }
  if (/\bnext week\b/.test(text)) {
    notes.push("Gmail search cannot reliably mean a date in the future. The keyword was kept instead.");
  }
  const keywords = ["invoice", "meeting", "teacher", "deadline", "lab"];
  for (const keyword of keywords) {
    if (text.includes(keyword) && !parts.some((part) => part.includes(keyword))) {
      parts.push(keyword);
    }
  }
  if (/\b(faculty|teacher)\b/.test(text) && !parts.includes("teacher")) parts.push("teacher");
  if (parts.length === 0) {
    const bare = text.replace(/[^\p{L}\p{N}\s@._-]/gu, "").trim();
    if (!bare || /^(show|find|emails|email|messages|me|my|the|a|an)$/.test(bare)) {
      return notUnderstood("That request did not map to a supported mailbox search.");
    }
    try {
      const query = assertSafeGmailQuery(bare);
      return {
        understood: true,
        gmailQuery: query,
        explanation: "Used the words as a mailbox keyword search.",
        exhaustive: false,
        method: "rules",
        mock: false,
      };
    } catch {
      return notUnderstood("That request used unsupported search syntax.");
    }
  }
  try {
    const gmailQuery = assertSafeGmailQuery(parts.join(" "));
    return {
      understood: true,
      gmailQuery,
      explanation: [
        `Interpreted as ${gmailQuery}.`,
        ...notes,
        "This is a rules interpretation, not a language model, and it is not exhaustive.",
      ].join(" "),
      exhaustive: false,
      method: "rules",
      mock: false,
    };
  } catch {
    return notUnderstood("The interpreted query failed the safety check.");
  }
}

function notUnderstood(explanation: string): SearchInterpretation {
  return {
    understood: false,
    gmailQuery: null,
    explanation,
    exhaustive: false,
    method: "rules",
    mock: false,
  };
}
