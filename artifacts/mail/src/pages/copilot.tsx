import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/fluent/shell";
import { api, type ThreadSummary } from "@/lib/api";

export function CopilotPage() {
  const threads = useQuery({
    queryKey: ["threads", "inbox"],
    queryFn: () => api<{ threads: ThreadSummary[] }>("/api/threads?view=inbox"),
  });
  const [threadId, setThreadId] = useState("");
  const [instruction, setInstruction] = useState("Make it clearer");
  const [draft, setDraft] = useState("");
  const assist = useMutation({
    mutationFn: () =>
      api<{ mock: boolean; body: string; notes: string[]; sent: false }>("/api/ai/drafts", {
        method: "POST",
        body: JSON.stringify({ threadId, instruction, draft }),
      }),
    onSuccess: (result) => setDraft(result.body),
  });
  return (
    <section>
      <PageHeader
        title="Copilot"
        lede="Drafts stay editable and local. Copilot cannot archive, delete, send, or change settings."
      />
      <form
        className="draft-box"
        onSubmit={(event) => {
          event.preventDefault();
          if (threadId) assist.mutate();
        }}
      >
        <label htmlFor="copilot-thread">Conversation</label>
        <select id="copilot-thread" value={threadId} onChange={(event) => setThreadId(event.target.value)}>
          <option value="">Choose a conversation</option>
          {(threads.data?.threads ?? []).map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.subject}
            </option>
          ))}
        </select>
        <label htmlFor="copilot-instruction">Instruction</label>
        <input id="copilot-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
        <label htmlFor="copilot-draft">Draft</label>
        <textarea id="copilot-draft" value={draft} onChange={(event) => setDraft(event.target.value)} rows={8} />
        <button className="button primary" type="submit">
          Write draft
        </button>
        {assist.data?.mock ? <p role="status">Mock result. Not a live model. {assist.data.notes.join(" ")}</p> : null}
        {assist.data && !assist.data.mock ? <p role="status">Draft updated. It has not been sent.</p> : null}
      </form>
      <p>
        <Link href="/inbox">Review the inbox yourself before archiving or trashing.</Link>
      </p>
    </section>
  );
}
