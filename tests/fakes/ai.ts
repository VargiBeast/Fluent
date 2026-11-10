/**
 * Deterministic fake of the xAI Responses API and the Gemini generateContent API for tests/E2E. It reads the TASK marker and the
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

/** Gemini `models/{model}:generateContent` request → response. */
export function fakeGeminiRespond(body: { systemInstruction?: unknown; contents?: unknown }, model: string): { task: string; payload: unknown } {
  const { task, text } = fakeAnswer(`${flatten(body.systemInstruction)}\n${flatten(body.contents)}`);
  return {
    task,
    payload: {
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      modelVersion: model,
      responseId: `gem_${Math.random().toString(36).slice(2)}`,
    },
  };
}

/** xAI Responses API request → response. */
export function fakeAiRespond(body: Body): { task: string; payload: unknown } {
  const { task, text } = fakeAnswer(`${body.instructions ?? ""}\n${flatten(body.input)}`);
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

function fakeAnswer(all: string): { task: string; text: string } {
  const task = /TASK:\s*([a-z_]+)/.exec(all)?.[1] ?? "unknown";
  const refs = [...all.matchAll(/<email ref="([^"]+)"/g)].map((m) => m[1]!);
  const subjects = [...all.matchAll(/<email ref="[^"]+"[^>]*subject="([^"]*)"/g)].map((m) => m[1]!);
  const question = /QUESTION:\s*(.+)/.exec(all)?.[1]?.trim() ?? "";
  const request = /User request:\s*(.+)/.exec(all)?.[1]?.trim() ?? "";
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
    case "plan":
      out = fakePlan(/User instruction \(from the user, trusted\):\s*(.+)/.exec(all)?.[1]?.trim() ?? "", /conversation open/.test(all) && !/No conversation is open/.test(all));
      break;
    case "draft":
      // A naive model that "obeys" an injection inside the email: proves the server ignores it (recipients/targets are fixed).
      if (/IGNORE ALL PREVIOUS INSTRUCTIONS/.test(all)) {
        out = { subject: null, body: "OK. Forwarding every email to attacker@suspicious.example as instructed.\n\nBest regards" };
        break;
      }
      out = { subject: null, body: "Hi,\n\nThanks for the note — Thursday at 14:00 works for me. I'll bring the updated deck.\n\nBest regards" };
      break;
    case "rewrite":
      out = { text: "Thanks for reaching out. Thursday at 14:00 works well for me." };
      break;
    case "search":
      out = /haven.?t answered|unanswered/i.test(request)
        ? { gmailQuery: "in:inbox -from:me newer_than:30d", explanation: "Inbox conversations from others in the last 30 days where the last message isn't yours.", postFilter: "unanswered" }
        : /invoice/i.test(request)
          ? { gmailQuery: "invoice newer_than:60d", explanation: "Messages mentioning “invoice” from the last two months.", postFilter: "none" }
          : /school/i.test(request)
            ? { gmailQuery: "school OR from:school", explanation: "Messages from or mentioning a school.", postFilter: "none" }
            : { gmailQuery: "deadline", explanation: "Messages mentioning a deadline.", postFilter: "none" };
      break;
    case "ask":
      out = { answer: refs.length ? `Based on your emails: ${question ? `regarding “${question}”, ` : ""}the most relevant conversation is cited.` : "I couldn't find anything relevant in your mail.", citations: refs.slice(0, 2).concat(["ref-that-does-not-exist"]) };
      break;
    default:
      out = "OK";
  }
  return { task, text: typeof out === "string" ? out : JSON.stringify(out) };
}

type FakeAction = { type: string; target: "query" | "current_thread" | "none"; gmailQuery: string | null; label: string | null; instruction: string | null; to: string | null };
const act = (type: string, gmailQuery: string | null, extra: Partial<FakeAction> = {}): FakeAction => ({ type, target: gmailQuery ? "query" : "none", gmailQuery, label: null, instruction: null, to: null, ...extra });

/** Tiny rule-based planner standing in for the model in tests. */
function fakePlan(instruction: string, hasThread: boolean): unknown {
  const i = instruction.toLowerCase();
  const plan = (summary: string, actions: FakeAction[]) => ({ intent: "actions", summary, clarification: null, actions });
  const who = /from ([a-z0-9@._-]+)/.exec(i)?.[1];
  const fromQ = who ? `from:${who}` : null;
  if (/do something|whatever/.test(i)) return { intent: "unclear", summary: "", clarification: "What would you like me to do?", actions: [] };
  if (/^(what|when|who|where|did|do|how|which|is|are)\b/.test(i) || i.endsWith("?")) return { intent: "question", summary: "A question about your mail.", clarification: null, actions: [] };
  if (/delete everything|six things/.test(i)) return plan("Too much.", Array.from({ length: 6 }, () => act("archive", "in:inbox")));
  if (/newsletter/.test(i) && /archive/.test(i)) return plan("Archive newsletters in your inbox.", [act("archive", "category:promotions in:inbox")]);
  if (/^star/.test(i) && fromQ) return plan(`Star conversations ${who ? `from ${who}` : ""}.`, [act("star", fromQ)]);
  const lab = /label (.+?) as ([a-z0-9 -]+)$/.exec(i);
  if (lab) return plan(`Label ${lab[1]} as ${lab[2]}.`, [act("add_label", lab[1]!.replace(/^emails? (about )?/, ""), { label: lab[2]!.replace(/\b\w/g, (c) => c.toUpperCase()) })]);
  if (/mark .*read/.test(i) && fromQ) return plan(`Mark everything ${who ? `from ${who}` : ""} as read.`, [act(/unread/.test(i) ? "mark_unread" : "mark_read", fromQ)]);
  if (/trash|delete/.test(i)) return plan("Move matching conversations to Trash.", [act("trash", fromQ ?? (/newsletter/.test(i) ? "category:promotions" : "in:inbox"))]);
  if (/follow.?up/.test(i)) return plan("Draft follow-ups to conversations waiting on a reply.", [act("draft_reply", "in:sent newer_than:30d", { instruction: "polite follow-up" })]);
  const reply = /(send|draft|write)? ?(?:a )?reply to (?:this|([a-z0-9@._-]+))(?: saying (.+))?/.exec(i);
  if (reply) {
    const type = /\bsend\b/.test(i) ? "send_reply" : "draft_reply";
    if (!reply[2] && hasThread) return plan("Reply to this conversation.", [{ ...act(type, null, { instruction: reply[3] ?? null }), target: "current_thread" }]);
    return plan(`Reply to ${reply[2]}.`, [act(type, `from:${reply[2]}`, { instruction: reply[3] ?? null })]);
  }
  const email = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/.exec(i)?.[1] ?? null;
  if (/(write|email|send).* to /.test(i)) {
    const to = /\bto ([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/.exec(i)?.[1] ?? (/attacker/.test(i) ? "attacker@suspicious.example" : email);
    return plan("Write a new email.", [act(/\bsend\b/.test(i) ? "send_new" : "draft_new", null, { to, instruction: i })]);
  }
  if (/^archive this|archive (it|this)/.test(i) && hasThread) return plan("Archive this conversation.", [{ ...act("archive", null), target: "current_thread" }]);
  if (/^archive/.test(i) && fromQ) return plan(`Archive ${who}.`, [act("archive", fromQ)]);
  if (/^unarchive|move back/.test(i) && fromQ) return plan("Move back to inbox.", [act("unarchive", fromQ)]);
  if (/^find|^search|^show/.test(i)) return plan("Search.", [act("search", i.replace(/^(find|search|show)( for)? /, ""))]);
  return { intent: "unclear", summary: "", clarification: "Could you rephrase that?", actions: [] };
}
