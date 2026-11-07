import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Button, ErrorState, LoadingState, PageHeader } from "@/components/fluent/states";
import { api, ApiClientError, type ThreadSummary } from "@/lib/api";

export function CopilotPage() {
  const threads = useQuery({
    queryKey: ["threads", "inbox"],
    queryFn: () => api<{ threads: ThreadSummary[] }>("/api/threads?view=inbox"),
  });
  const [threadId, setThreadId] = useState("");
  const [instruction, setInstruction] = useState("Make it clearer");
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const search = useMutation({
    mutationFn: (query: string) =>
      api<{
        interpretation: { understood: boolean; explanation: string; method: string; mock: boolean; exhaustive: false };
        threads: ThreadSummary[];
      }>("/api/search", { method: "POST", body: JSON.stringify({ query, view: "inbox" }) }),
  });
  const assist = useMutation({
    mutationFn: () =>
      api<{ mock: boolean; body: string; notes: string[]; sent: false }>("/api/ai/drafts", {
        method: "POST",
        body: JSON.stringify({ threadId, instruction, draft }),
      }),
    onSuccess: (result) => setDraft(result.body),
  });
  const summary = useMutation({
    mutationFn: () =>
      api<{ mock: boolean; summary: string; sourceMessageIds: string[]; uncertainty: string | null }>(
        `/api/ai/threads/${threadId}/summary`,
        { method: "POST", body: "{}" },
      ),
  });
  return (
    <section data-screen="copilot">
      <PageHeader
        title="Copilot"
        lede="A workspace for reading and drafting. It cannot archive, delete, send, or change settings. Suggestions are not confirmed facts."
      />
      <form
        className="search-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) search.mutate(question.trim());
        }}
      >
        <label className="field" htmlFor="copilot-search">
          <span>Ask the mailbox</span>
          <input id="copilot-search" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Show messages about an invoice" />
        </label>
        <Button type="submit" disabled={search.isPending}>
          {search.isPending ? "Searching" : "Search"}
        </Button>
      </form>
      {search.data ? (
        <article className="surface" role="status">
          <p>{search.data.interpretation.explanation}</p>
          <p className="hint">{search.data.interpretation.method === "rules" ? "Rules interpreter, not a live model." : "Model interpretation."} Not exhaustive.</p>
          <ul>
            {search.data.threads.map((thread) => (
              <li key={thread.id}>
                <Link href={`/inbox/${thread.id}`}>{thread.subject}</Link>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
      {search.isError ? <ErrorState message={search.error instanceof ApiClientError ? search.error.message : "Search failed"} /> : null}
      <form
        className="draft-box"
        onSubmit={(event) => {
          event.preventDefault();
          if (threadId) assist.mutate();
        }}
      >
        <label className="field" htmlFor="copilot-thread">
          <span>Conversation</span>
          <select id="copilot-thread" value={threadId} onChange={(event) => setThreadId(event.target.value)}>
            <option value="">Choose a conversation</option>
            {(threads.data?.threads ?? []).map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.subject}
              </option>
            ))}
          </select>
        </label>
        {threads.isLoading ? <LoadingState label="Loading conversations" /> : null}
        {threads.isError ? <ErrorState message="Could not load conversations." /> : null}
        <div className="row-actions">
          <Button type="button" onClick={() => threadId && summary.mutate()} disabled={!threadId || summary.isPending}>
            {summary.isPending ? "Summarizing" : "Summarize selection"}
          </Button>
        </div>
        {summary.data ? (
          <p role="status">
            {summary.data.mock ? "Mock summary. " : ""}
            {summary.data.summary} {summary.data.uncertainty ?? ""} Sources: {summary.data.sourceMessageIds.join(", ") || "none"}.
          </p>
        ) : null}
        {summary.isError ? <ErrorState message="Summary failed." /> : null}
        <label className="field" htmlFor="copilot-instruction">
          <span>Instruction</span>
          <input id="copilot-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
        </label>
        <label className="field" htmlFor="copilot-draft">
          <span>Draft</span>
          <textarea id="copilot-draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <Button variant="primary" type="submit" disabled={!threadId || assist.isPending}>
          {assist.isPending ? "Writing" : "Write draft"}
        </Button>
        {assist.data?.mock ? <p role="status">Mock result. Not a live model. {assist.data.notes.join(" ")} Not sent.</p> : null}
        {assist.isError ? <ErrorState message="Draft assist failed." /> : null}
      </form>
    </section>
  );
}
