/**
 * Spoken commands for dictation, e.g. "reply to Ola that I'll come at 3" or "email Sofia saying the deck is ready".
 * They only ever produce a *draft*: there is deliberately no "send" outcome, even when the user says "send".
 */
export interface VoiceCommand {
  kind: "reply" | "new";
  /** Who it's for, as spoken ("Ola", "Sofia Lindqvist"). */
  recipient: string;
  /** The message, cleaned up ("I'll come at 3."). */
  message: string;
}

const NAME = String.raw`([\p{L}][\p{L}.'’-]*(?:\s+[\p{L}][\p{L}.'’-]*){0,2}?)`;
const BODY = String.raw`(.+)`;
const PATTERNS: Array<{ kind: VoiceCommand["kind"]; re: RegExp }> = [
  { kind: "reply", re: new RegExp(String.raw`^(?:send\s+(?:an?\s+)?)?(?:reply|respond|answer|write back)\s+to\s+${NAME}\s*(?:,|:|\s(?:that|saying|and say(?: that)?|and tell (?:him|her|them)(?: that)?))\s*${BODY}$`, "iu") },
  { kind: "reply", re: new RegExp(String.raw`^svar(?:\s+til)?\s+${NAME}\s*(?:,|:|\s(?:at|og si(?: at)?))\s*${BODY}$`, "iu") },
  { kind: "new", re: new RegExp(String.raw`^(?:e-?mail|write(?:\s+an?\s+(?:e-?mail|message))?\s+to|send\s+(?:an?\s+)?(?:e-?mail|message)\s+to|draft\s+(?:an?\s+)?(?:e-?mail|message)\s+to|message|write)\s+${NAME}\s*(?:,|:|\s(?:that|saying|about))\s*${BODY}$`, "iu") },
  { kind: "new", re: new RegExp(String.raw`^(?:skriv|send\s+(?:en\s+)?e-?post)\s+til\s+${NAME}\s*(?:,|:|\s(?:at|om))\s*${BODY}$`, "iu") },
];
const NOT_NAMES = new Set(["me", "myself", "everyone", "all", "them", "him", "her", "this", "that", "it", "meg"]);

export function tidyMessage(text: string): string {
  let t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

export function parseVoiceCommand(transcript: string): VoiceCommand | null {
  const t = transcript.trim().replace(/\s+/g, " ").replace(/^(?:(?:ok(?:ay)?|hey|please|fluent|copilot)[,\s]+)+/i, "").replace(/[.!]+$/, "");
  if (t.length > 1000) return null;
  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    const recipient = m[1]!.trim();
    const message = tidyMessage(m[2]!);
    if (!message || NOT_NAMES.has(recipient.toLowerCase())) return null;
    return { kind: p.kind, recipient, message };
  }
  return null;
}

/** Only letters, digits, spaces and a few name characters reach the Gmail query, always quoted. */
export function recipientQuery(field: "from" | "to", recipient: string): string | null {
  const clean = recipient.normalize("NFC").replace(/[^\p{L}\p{N} .'’-]/gu, "").trim().slice(0, 60);
  return clean ? `${field}:"${clean}"` : null;
}

/** "Hi Ola,\n\nI'll come at 3." — greets with the first name the user said. */
export function draftBody(cmd: VoiceCommand): string {
  const first = cmd.recipient.split(/\s+/)[0]!;
  return `Hi ${first.charAt(0).toUpperCase() + first.slice(1)},\n\n${cmd.message}`;
}

export function draftSubject(message: string): string {
  const words = message.replace(/[.!?…]+$/, "").split(/\s+/);
  const s = words.slice(0, 8).join(" ");
  return words.length > 8 ? `${s}…` : s;
}

/** Does this address/name look like the person the user said? */
export function matchesRecipient(a: { name: string; email: string }, recipient: string): boolean {
  const r = recipient.toLowerCase();
  const name = a.name.toLowerCase();
  const first = r.split(/\s+/)[0]!;
  return name.includes(r) || a.email.toLowerCase().split("@")[0]!.includes(first) || name.split(/\s+/).includes(first);
}
