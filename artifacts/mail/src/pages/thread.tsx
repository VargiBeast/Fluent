import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useRoute } from "wouter";
import { ErrorState, LoadingState, PageHeader } from "@/components/fluent/shell";
import { api, ApiClientError, type ThreadDetail } from "@/lib/api";
import { buildSafeEmailDocument } from "@/lib/email-frame";

export function ThreadPage() {
  const [, params] = useRoute("/inbox/:id");
  const id = params?.id ?? "";
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [summaryNote, setSummaryNote] = useState<string | null>(null);
  const thread = useQuery({
    queryKey: ["thread", id],
    enabled: Boolean(id),
    queryFn: () => api<ThreadDetail>(`/api/threads/${id}`),
  });
  const summarize = useMutation({
    mutationFn: () =>
      api<{
        mock: boolean;
        summary: string;
        decisions: string[];
        questions: string[];
        actions: string[];
        dates: string[];
        uncertainty: string | null;
        untrustedInstructionsIgnored: boolean;
      }>(`/api/ai/threads/${id}/summary`, { method: "POST", body: "{}" }),
    onSuccess: (result) => {
      const label = result.mock ? "Mock analysis, not a live model. " : "";
      setSummaryNote(
        `${label}${result.summary} Decisions: ${result.decisions.join(" ") || "none stated"}. Questions: ${
          result.questions.join(" ") || "none stated"
        }. Actions: ${result.actions.join(" ") || "none stated"}. Dates: ${result.dates.join(", ") || "none stated"}. ${
          result.uncertainty ?? ""
        }${result.untrustedInstructionsIgnored ? " Untrusted instructions in the mail were ignored." : ""}`,
      );
    },
  });
  const assist = useMutation({
    mutationFn: (instruction: string) =>
      api<{ mock: boolean; body: string; notes: string[]; sent: false }>("/api/ai/drafts", {
        method: "POST",
        body: JSON.stringify({ threadId: id, instruction, draft }),
      }),
    onSuccess: (result) => setDraft(result.body),
  });
  const save = useMutation({
    mutationFn: () =>
      api("/api/drafts", {
        method: "POST",
        body: JSON.stringify({
          threadId: id,
          kind: "reply",
          toEmail: thread.data?.messages.at(-1)?.fromEmail ?? "",
          subject: thread.data ? `Re: ${thread.data.subject}` : "",
          body: draft,
        }),
      }),
  });
  if (thread.isLoading) return <LoadingState label="Loading conversation" />;
  if (thread.isError || !thread.data) {
    return <ErrorState message={thread.error instanceof ApiClientError ? thread.error.message : "Conversation unavailable"} />;
  }
  const data = thread.data;
  return (
    <section>
      <PageHeader title={data.subject} lede={data.synthetic ? "Synthetic demo conversation." : "Gmail conversation."} />
      <p>
        <Link href="/inbox">Back to inbox</Link>
      </p>
      <div className="row-actions">
        <button type="button" className="button secondary" onClick={() => summarize.mutate()}>
          Summarize
        </button>
      </div>
      {summaryNote ? (
        <article className="surface-card" role="status">
          <h2>Thread summary</h2>
          <p>{summaryNote}</p>
          <Link href={`/inbox/${data.id}`}>View the source conversation</Link>
        </article>
      ) : null}
      {summarize.isError ? (
        <ErrorState message={summarize.error instanceof ApiClientError ? summarize.error.message : "Summary failed"} />
      ) : null}
      <ol className="message-list">
        {data.messages.map((message) => {
          const open = openId === message.id || data.messages.length === 1;
          return (
            <li key={message.id}>
              <button type="button" className="message-toggle" onClick={() => setOpenId(open ? null : message.id)} aria-expanded={open}>
                <strong>{message.fromName || message.fromEmail}</strong>
                <span>{message.fromEmail}</span>
                <time dateTime={message.internalDate}>{new Date(message.internalDate).toLocaleString()}</time>
              </button>
              {open ? (
                <div>
                  <p className="recipients">To {message.to.join(", ") || "unknown"}</p>
                  {message.attachments.length ? (
                    <ul>
                      {message.attachments.map((attachment) => (
                        <li key={attachment.filename}>
                          {attachment.filename}
                          {attachment.sizeBytes ? ` (${attachment.sizeBytes} bytes)` : ""}. FLUENT does not download the file.
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <iframe
                    className="email-frame"
                    title={`Message from ${message.fromEmail}`}
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    referrerPolicy="no-referrer"
                    srcDoc={buildSafeEmailDocument(message.bodyHtml || `<p>${message.bodyText}</p>`, {
                      allowRemoteImages: false,
                    })}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <form
        className="draft-box"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <h2>Reply draft</h2>
        <p>Saved in FLUENT only. Nothing is sent.</p>
        <label htmlFor="reply-body">Draft</label>
        <textarea id="reply-body" value={draft} onChange={(event) => setDraft(event.target.value)} rows={8} />
        <div className="row-actions">
          {["Make it shorter", "More professional", "Friendlier", "Clearer"].map((instruction) => (
            <button key={instruction} type="button" className="button secondary" onClick={() => assist.mutate(instruction)}>
              {instruction}
            </button>
          ))}
          <button className="button primary" type="submit">
            Save local draft
          </button>
        </div>
        {assist.data?.mock ? <p role="status">Mock writing assist. Not a live model. Edit the text before saving.</p> : null}
        {save.isSuccess ? <p role="status">Draft saved on the server. It was not sent.</p> : null}
      </form>
    </section>
  );
}
