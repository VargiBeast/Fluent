import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { ConfirmDialog } from "@/components/fluent/confirm-dialog";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/fluent/shell";
import { api, ApiClientError, type ThreadSummary } from "@/lib/api";

export function InboxPage({ view = "inbox" }: { view?: string }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [pending, setPending] = useState<{ thread: ThreadSummary; action: "archive" | "trash" } | null>(null);
  const queryClient = useQueryClient();
  const search = useQuery({
    queryKey: ["search", submitted, view],
    enabled: submitted.length > 0,
    queryFn: () =>
      api<{
        interpretation: { understood: boolean; explanation: string; gmailQuery: string | null; exhaustive: false; method: string; mock: boolean };
        threads: ThreadSummary[];
        source: string;
      }>("/api/search", { method: "POST", body: JSON.stringify({ query: submitted }) }),
  });
  const inbox = useQuery({
    queryKey: ["threads", view],
    enabled: submitted.length === 0,
    queryFn: () =>
      api<{ threads: ThreadSummary[]; source: string; exhaustive: false; nextPageToken: string | null }>(
        `/api/threads?view=${encodeURIComponent(view)}`,
      ),
  });
  const sync = useMutation({
    mutationFn: () => api("/api/gmail/sync", { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });
  const act = useMutation({
    mutationFn: async (input: { thread: ThreadSummary; action: "archive" | "trash" }) => {
      const approval = await api<{ approvalId: string }>("/api/approvals", {
        method: "POST",
        body: JSON.stringify({ threadId: input.thread.id, action: input.action }),
      });
      await api(`/api/threads/${input.thread.id}/${input.action}`, {
        method: "POST",
        body: JSON.stringify({ approvalId: approval.approvalId }),
      });
    },
    onSuccess: async () => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });
  const data = submitted ? search.data : inbox.data;
  const threads = data?.threads ?? [];
  const loading = submitted ? search.isLoading : inbox.isLoading;
  const error = submitted ? search.error : inbox.error;
  const title = view === "sent" ? "Sent" : "Inbox";
  return (
    <section>
      <PageHeader
        title={title}
        lede={
          data?.source === "demo"
            ? "Synthetic demo conversations. Not your Gmail, and not an exhaustive search."
            : data?.source === "gmail"
              ? "Loaded from Gmail one page at a time. Search is not exhaustive."
              : "Connect Gmail or use a labeled demo session to see mail."
        }
      />
      <form
        className="search-row"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <label htmlFor="mail-search">Search</label>
        <input
          id="mail-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find emails about an invoice"
        />
        <button className="button secondary" type="submit">
          Search
        </button>
        <button className="button secondary" type="button" onClick={() => sync.mutate()}>
          Refresh
        </button>
      </form>
      {search.data ? (
        <p className="interpretation" role="status">
          {search.data.interpretation.understood
            ? search.data.interpretation.explanation
            : `Could not understand that search. ${search.data.interpretation.explanation}`}
          {search.data.interpretation.method === "rules" ? " Rules interpreter, not a live model." : ""}
        </p>
      ) : null}
      {loading ? <LoadingState label="Loading conversations" /> : null}
      {error ? <ErrorState message={error instanceof ApiClientError ? error.message : "Could not load mail"} /> : null}
      {!loading && !error && threads.length === 0 ? (
        <EmptyState title="Nothing in this view" body="New mail, a refresh, or a different search will show up here." />
      ) : null}
      <ul className="thread-list">
        {threads.map((thread) => (
          <li key={thread.id} className={thread.isUnread ? "unread" : ""}>
            <Link href={`/inbox/${thread.id}`}>
              <span className="from">{thread.fromName || thread.fromEmail}</span>
              <span className="subject">{thread.subject}</span>
              <span className="snippet">{thread.snippet}</span>
              <span className="meta">
                {new Date(thread.lastMessageAt).toLocaleString()}
                {thread.hasAttachments ? " · Attachment" : ""}
                {thread.isImportant ? " · Important" : ""}
                {thread.isStarred ? " · Starred" : ""}
                {thread.isUnread ? " · Unread" : ""}
              </span>
            </Link>
            {view !== "sent" ? (
              <div className="thread-actions">
                <button type="button" className="button secondary" onClick={() => setPending({ thread, action: "archive" })}>
                  Archive
                </button>
                <button type="button" className="button danger" onClick={() => setPending({ thread, action: "trash" })}>
                  Trash
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.action === "trash" ? "Move this conversation to Trash?" : "Archive this conversation?"}
        body={
          pending
            ? `${pending.thread.subject}. ${
                pending.action === "trash"
                  ? "FLUENT moves it to Trash. It does not permanently delete it."
                  : "It leaves the inbox and stays in All Mail."
              }`
            : ""
        }
        confirmLabel={pending?.action === "trash" ? "Move to Trash" : "Archive"}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && act.mutate(pending)}
      />
      {act.isError ? <ErrorState message={act.error instanceof ApiClientError ? act.error.message : "The action failed"} /> : null}
    </section>
  );
}
