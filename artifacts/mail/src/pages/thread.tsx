import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useRoute } from "wouter";
import { Button, ErrorState, LoadingState, PageHeader } from "@/components/fluent/states";
import { useToast } from "@/components/fluent/toast";
import { api, ApiClientError, type ThreadDetail } from "@/lib/api";
import { buildSafeEmailDocument } from "@/lib/email-frame";

export function ThreadPage() {
  const [, params] = useRoute("/inbox/:id");
  const id = params?.id ?? "";
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const toast = useToast();
  const prefs = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api<{ loadRemoteImages: boolean }>("/api/preferences"),
  });
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
        sourceMessageIds: string[];
      }>(`/api/ai/threads/${id}/summary`, { method: "POST", body: "{}" }),
    onSuccess: (result) => {
      setSummary(
        `${result.mock ? "Mock analysis, not a live model. " : ""}${result.summary} Decisions: ${
          result.decisions.join(" ") || "none stated"
        }. Questions: ${result.questions.join(" ") || "none stated"}. Actions: ${
          result.actions.join(" ") || "none stated"
        }. Dates: ${result.dates.join(", ") || "none stated"}. ${result.uncertainty ?? ""}${
          result.untrustedInstructionsIgnored ? " Untrusted instructions were ignored." : ""
        } Sources: ${result.sourceMessageIds.join(", ")}`,
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
    mutationFn: () => {
      const payload = {
        threadId: id,
        kind: "reply" as const,
        toEmail: thread.data?.messages.at(-1)?.fromEmail ?? "",
        subject: thread.data ? `Re: ${thread.data.subject}` : "",
        body: draft,
      };
      if (draftId) {
        return api<{ id: string }>(`/api/drafts/${draftId}`, { method: "PUT", body: JSON.stringify(payload) });
      }
      return api<{ id: string }>("/api/drafts", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: (result) => {
      setDraftId(result.id);
      setSaved(draft);
      toast.notify({ title: "Draft saved", body: "Stored in FLUENT only. It was not sent." });
    },
  });
  if (thread.isLoading) return <LoadingState label="Loading conversation" />;
  if (thread.isError || !thread.data) {
    return <ErrorState message={thread.error instanceof ApiClientError ? thread.error.message : "Conversation unavailable"} />;
  }
  const data = thread.data;
  const dirty = draft !== saved;
  return (
    <section data-screen="thread">
      <PageHeader title={data.subject} lede={data.synthetic ? "Synthetic demo conversation." : "Mailbox conversation."} />
      <p>
        <Link href="/inbox">Back to inbox</Link>
      </p>
      <div className="row-actions">
        <Button type="button" onClick={() => summarize.mutate()} disabled={summarize.isPending}>
          {summarize.isPending ? "Summarizing" : "Summarize"}
        </Button>
      </div>
      {summary ? (
        <article className="surface" role="status">
          <h2>Thread summary</h2>
          <p>{summary}</p>
          <a href={`#message-${data.messages[0]?.id ?? "top"}`}>View the source messages below</a>
        </article>
      ) : null}
      {summarize.isError ? <ErrorState message={summarize.error instanceof ApiClientError ? summarize.error.message : "Summary failed"} /> : null}
      <ol className="thread-list">
        {data.messages.map((message) => {
          const open = openId === message.id || data.messages.length === 1;
          return (
            <li key={message.id} id={`message-${message.id}`} className="surface">
              <button type="button" className="button secondary message-toggle" onClick={() => setOpenId(open ? null : message.id)} aria-expanded={open}>
                <strong>{message.fromName || message.fromEmail}</strong>
                <span>{message.fromEmail}</span>
                <time dateTime={message.internalDate}>{new Date(message.internalDate).toLocaleString()}</time>
              </button>
              {open ? (
                <div>
                  <p className="hint">To {message.to.join(", ") || "unknown"}</p>
                  {message.attachments.length ? (
                    <ul>
                      {message.attachments.map((attachment) => (
                        <li key={attachment.filename}>
                          {attachment.filename}
                          {attachment.sizeBytes ? ` (${attachment.sizeBytes} bytes)` : ""}. File bytes are not downloaded.
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
                      allowRemoteImages: prefs.data?.loadRemoteImages ?? false,
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
        <p className="hint">Saved in FLUENT only. Nothing is sent. {dirty ? <span className="dirty">Unsaved changes</span> : "Saved"}</p>
        <label className="field" htmlFor="reply-body">
          <span>Draft</span>
          <textarea id="reply-body" value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <div className="row-actions">
          {["Make it shorter", "More professional", "Friendlier", "Clearer"].map((instruction) => (
            <Button key={instruction} type="button" onClick={() => assist.mutate(instruction)} disabled={assist.isPending}>
              {instruction}
            </Button>
          ))}
          <Button variant="primary" type="submit" disabled={save.isPending || !dirty}>
            {save.isPending ? "Saving" : "Save local draft"}
          </Button>
        </div>
        {assist.data?.mock ? <p role="status">Mock writing assist. Not a live model. Edit before saving.</p> : null}
        {assist.isError ? <ErrorState message="The draft assist failed. Your text was not replaced." /> : null}
        {save.isError ? <ErrorState message="The draft could not be saved." /> : null}
      </form>
    </section>
  );
}
