/**
 * Deterministic fake of the xAI Responses API for tests/E2E. It reads the TASK marker and the
 * delimited email references FLUENT sends, and answers in the requested JSON shape, so tests can
 * verify grounding (only real refs are cited) without a live model.
 */
interface Body {
  model?: string;
  input?: unknown;
  instructions?: string;
  text?: { format?: { type?: string } };
}

function flatten(input: unknown): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map(flatten).join("\n");
  if (input && typeof input === "object") return Object.values(input as Record<string, unknown>).map(flatten).join("\n");
  return "";
}

export function fakeAiRespond(body: Body): { task: string; payload: unknown } {
  const all = `${body.instructions ?? ""}\n${flatten(body.input)}`;
  const task = /TASK:\s*([a-z_]+)/.exec(all)?.[1] ?? "unknown";
  const refs = [...all.matchAll(/<email ref="([^"]+)"/g)].map((m) => m[1]!);
  const subjects = [...all.matchAll(/<email ref="[^"]+"[^>]*subject="([^"]*)"/g)].map((m) => m[1]!);
  const question = /QUESTION:\s*(.+)/.exec(all)?.[1]?.trim() ?? "";
  let out: unknown;
  switch (task) {
    case "overview":
      out = {
        headline: `You have ${refs.length} recent conversations; ${Math.min(2, refs.length)} need a reply soon.`,
        items: refs.slice(0, 5).map((r, i) => ({
          ref: r,
          category: (["needs_reply", "deadline", "important", "waiting", "fyi"] as const)[i % 5],
          reason: `Fake model reasoning about ${subjects[i] ?? "this thread"}.`,
          due: i === 1 ? "Friday" : null,
        })),
      };
      break;
    case "insights":
      out = {
        summary: `Fake summary of a thread with ${refs.length} message(s).`,
        keyPoints: ["Confirm the meeting time", "Sign-off needed before the deadline"],
        actionItems: [{ task: "Reply with confirmation", owner: "you", due: "Thursday" }],
        deadlines: [{ what: "Sign-off", when: "Friday" }],
        needsReply: true,
      };
      break;
    case "explain":
      out = "In plain terms: the sender is asking you to confirm a time and deliver something before a deadline.";
      break;
    case "draft":
      out = { subject: null, body: "Hi,\n\nThanks for the note — Thursday at 14:00 works for me. I'll bring the updated deck.\n\nBest regards" };
      break;
    case "rewrite":
      out = { text: "Thanks for reaching out. Thursday at 14:00 works well for me." };
      break;
    case "search":
      out = /haven.?t answered|unanswered/i.test(all)
        ? { gmailQuery: "in:inbox -from:me newer_than:30d", explanation: "Inbox conversations from others in the last 30 days where the last message isn't yours.", postFilter: "unanswered" }
        : /invoice/i.test(all)
          ? { gmailQuery: "invoice newer_than:60d", explanation: "Messages mentioning “invoice” from the last two months.", postFilter: "none" }
          : /school/i.test(all)
            ? { gmailQuery: "school OR from:school", explanation: "Messages from or mentioning a school.", postFilter: "none" }
            : { gmailQuery: "deadline", explanation: "Messages mentioning a deadline.", postFilter: "none" };
      break;
    case "ask":
      out = { answer: refs.length ? `Based on your emails: ${question ? `regarding “${question}”, ` : ""}the most relevant conversation is cited.` : "I couldn't find anything relevant in your mail.", citations: refs.slice(0, 2).concat(["ref-that-does-not-exist"]) };
      break;
    default:
      out = "OK";
  }
  const text = typeof out === "string" ? out : JSON.stringify(out);
  return {
    task,
    payload: {
      id: `resp_${Math.random().toString(36).slice(2)}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: body.model ?? "fake",
      status: "completed",
      output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    },
  };
}
