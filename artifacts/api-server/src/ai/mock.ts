import type { DraftResult, OverviewResult, SummaryResult } from "./schemas";
import { INJECTION_PATTERN, splitSentences, withoutInjection } from "./schemas";

export interface GroundedMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
}

export interface GroundedThread {
  id: string;
  subject: string;
  snippet: string;
  needsReply: boolean;
  isImportant: boolean;
  isUnread: boolean;
}

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b/g;

export function mockSummarize(messages: GroundedMessage[]): SummaryResult {
  const sourceMessageIds = messages.map((message) => message.id);
  const subject = messages[0]?.subject ?? "";
  const sentences = splitSentences(messages.map((message) => message.body).join(" "));
  const { kept, ignored } = withoutInjection(sentences);
  const text = kept.join(" ");
  const questions = kept.filter((sentence) => sentence.includes("?")).slice(0, 4);
  const decisions = kept
    .filter((sentence) => /\b(agreed|decided|decision|we will)\b/i.test(sentence))
    .slice(0, 4);
  const actions = kept
    .filter((sentence) => /\b(please|can you|could you|owe|due)\b/i.test(sentence) && !INJECTION_PATTERN.test(sentence))
    .slice(0, 4);
  const dates = Array.from(new Set(text.match(DATE_PATTERN) ?? [])).slice(0, 6);
  const summary = kept.slice(0, 3).join(" ") || "The messages did not contain a usable sentence.";
  return {
    mock: true,
    model: "fluent-extractive-mock",
    subject,
    summary: summary.slice(0, 1200),
    important: kept.slice(0, 3),
    decisions,
    questions,
    actions,
    dates,
    uncertainty: dates.length
      ? "Mock analysis quotes only text present in the messages. It is not a live model."
      : "No explicit date was found in the messages. Mock analysis is not a live model.",
    untrustedInstructionsIgnored: ignored,
    sourceMessageIds,
  };
}

export function mockDraft(input: {
  messages: GroundedMessage[];
  instruction: string;
  currentDraft: string;
}): DraftResult {
  const { kept, ignored } = withoutInjection(
    splitSentences(input.messages.map((message) => message.body).join(" ")),
  );
  const subject = input.messages[0]?.subject ?? "your note";
  const fact = kept[0] ?? "I have the conversation in front of me.";
  const base = input.currentDraft.trim();
  let body = base || `Thanks for the note about ${subject}. ${fact}`;
  const instruction = input.instruction.toLowerCase();
  if (instruction.includes("short")) body = body.split(/[.!?]/)[0]?.trim().concat(".") ?? body;
  if (instruction.includes("professional")) {
    body = `Hello,\n\n${body}\n\nRegards`;
  } else if (instruction.includes("friend")) {
    body = `Hi,\n\n${body}\n\nThanks`;
  } else if (instruction.includes("clear") || instruction.includes("grammar")) {
    body = body.replace(/\s+/g, " ").trim();
  }
  if (INJECTION_PATTERN.test(input.instruction) || INJECTION_PATTERN.test(base)) {
    body = `Thanks for the note about ${subject}. ${fact}`;
  }
  return {
    mock: true,
    model: "fluent-extractive-mock",
    body: body.slice(0, 4000),
    notes: [
      "Mock draft. Not a live model. Edit it before saving. FLUENT will not send it.",
      ...(ignored ? ["Instructions embedded in the email were ignored."] : []),
    ],
    uncertainty: "The draft only restates text supplied to the mock adapter.",
  };
}

export function mockOverview(threads: GroundedThread[]): OverviewResult {
  const priorities = threads
    .filter((thread) => thread.isImportant || thread.isUnread)
    .slice(0, 4)
    .map((thread) => ({
      threadId: thread.id,
      reason: thread.isImportant
        ? `Marked important: ${thread.subject}`
        : `Unread: ${thread.subject}`,
    }));
  const followUps = threads
    .filter((thread) => thread.needsReply)
    .slice(0, 4)
    .map((thread) => ({
      threadId: thread.id,
      reason: `The latest stored message is not from you: ${thread.subject}`,
    }));
  const overview = threads.length
    ? `Mock overview of ${threads.length} stored conversations. ${priorities.length} look time-sensitive and ${followUps.length} look unanswered.`
    : "No stored conversations were available for a mock overview.";
  return {
    mock: true,
    model: "fluent-extractive-mock",
    overview,
    priorities,
    followUps,
    uncertainty: "Mock analysis uses stored subjects and flags only. It is not a live model and it does not take actions.",
    untrustedInstructionsIgnored: threads.some((thread) => INJECTION_PATTERN.test(thread.snippet)),
  };
}
