import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ConfirmDialog } from "@/components/fluent/confirm-dialog";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/fluent/states";
import { useToast } from "@/components/fluent/toast";
import { api, ApiClientError, type ThreadSummary } from "@/lib/api";

const FILTERS = [
  { id: "all", label: "Loaded" },
  { id: "unread", label: "Unread" },
  { id: "starred", label: "Starred" },
  { id: "important", label: "Important" },
] as const;

export function InboxPage({ view = "inbox" }: { view?: string }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [pages, setPages] = useState<ThreadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState<{ thread: ThreadSummary; action: "archive" | "trash" } | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const title = view === "sent" ? "Sent" : view === "starred" ? "Starred" : "Inbox";

  const search = useQuery({
    queryKey: ["search", submitted, view, cursor],
    enabled: submitted.length > 0,
    queryFn: () =>
      api<{
        interpretation: { understood: boolean; explanation: string; gmailQuery: string | null; exhaustive: false; method: string; mock: boolean };
        threads: ThreadSummary[];
        source: string;
        nextPageToken: string | null;
      }>("/api/search", {
        method: "POST",
        body: JSON.stringify({ query: submitted, view, pageToken: cursor ?? undefined }),
      }),
  });
  const inbox = useQuery({
    queryKey: ["threads", view, cursor],
    enabled: submitted.length === 0,
    queryFn: () =>
      api<{ threads: ThreadSummary[]; source: string; exhaustive: false; nextPageToken: string | null }>(
        `/api/threads?view=${encodeURIComponent(view)}${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ""}`,
      ),
  });
  const active = submitted ? search : inbox;
  useEffect(() => {
    if (!active.data) return;
    setPages((current) => {
      const incoming = active.data?.threads ?? [];
      if (!cursor) return incoming;
      const known = new Set(current.map((thread) => thread.id));
      return [...current, ...incoming.filter((thread) => !known.has(thread.id))];
    });
  }, [active.data, cursor]);

  const sync = useMutation({
    mutationFn: () => api("/api/gmail/sync", { method: "POST", body: "{}" }),
    onSuccess: () => {
      setCursor(null);
      setPages([]);
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
      toast.notify({ title: "Mailbox refreshed", body: "This loaded one page. It is not a full export." });
    },
  });
  const flags = useMutation({
    mutationFn: (input: { id: string; unread?: boolean; starred?: boolean }) =>
      api(`/api/threads/${input.id}/flags`, {
        method: "POST",
        body: JSON.stringify({ unread: input.unread, starred: input.starred }),
      }),
    onSuccess: () => {
      setCursor(null);
      setPages([]);
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
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
    onSuccess: async (_data, input) => {
      setPending(null);
      setPages([]);
      setCursor(null);
      await queryClient.invalidateQueries({ queryKey: ["threads"] });
      toast.notify({
        title: input.action === "trash" ? "Moved to Trash" : "Archived",
        body: input.action === "trash" ? "Not permanently deleted." : "Removed from the inbox only.",
      });
    },
  });

  const categories = Array.from(new Set(pages.map((thread) => thread.category).filter(Boolean))) as string[];
  const visible = pages.filter((thread) => {
    if (filter === "unread" && !thread.isUnread) return false;
    if (filter === "starred" && !thread.isStarred) return false;
    if (filter === "important" && !thread.isImportant) return false;
    if (category !== "all" && thread.category !== category) return false;
    return true;
  });
  const next = active.data?.nextPageToken ?? null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        document.getElementById("mail-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section data-screen={view === "sent" ? "sent" : "inbox"}>
      <PageHeader
        title={title}
        lede={
          active.data?.source === "demo"
            ? "Synthetic demo conversations. Not your Gmail, and not an exhaustive search."
            : active.data?.source === "gmail"
              ? "One Gmail page at a time. Search is not exhaustive."
              : "Connect Gmail or use a labeled demo session."
        }
      />
      <form
        className="search-row"
        onSubmit={(event) => {
          event.preventDefault();
          setCursor(null);
          setPages([]);
          setSubmitted(query.trim());
        }}
      >
        <label className="field" htmlFor="mail-search">
          <span>Search this {title.toLowerCase()}</span>
          <input id="mail-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find emails about an invoice" />
        </label>
        <Button type="submit">Search</Button>
        <Button type="button" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? "Refreshing" : "Refresh"}
        </Button>
      </form>
      <div className="chip-row" role="toolbar" aria-label="Filters">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" className="chip" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
            {item.label}
          </button>
        ))}
        <label className="field category-field">
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
            <option value="all">All loaded categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      {search.data ? (
        <p className="hint" role="status">
          {search.data.interpretation.understood ? search.data.interpretation.explanation : `Not understood. ${search.data.interpretation.explanation}`}
          {search.data.interpretation.method === "rules" ? " Rules interpreter, not a live model." : ""}
          {view === "sent" ? " Limited to Sent." : ""}
        </p>
      ) : null}
      {active.isLoading && pages.length === 0 ? <LoadingState label={`Loading ${title.toLowerCase()}`} /> : null}
      {active.isError ? <ErrorState message={active.error instanceof ApiClientError ? active.error.message : "Could not load mail"} /> : null}
      {sync.isError ? <ErrorState message={sync.error instanceof ApiClientError ? sync.error.message : "Refresh failed"} /> : null}
      {!active.isLoading && !active.isError && visible.length === 0 ? (
        <EmptyState title="Nothing in this view" body="Try another filter, load another page, or refresh." />
      ) : null}
      <div className="inbox-split">
        <ul className="thread-list">
          {visible.map((thread) => (
            <li key={thread.id} className={`thread-card ${thread.isUnread ? "unread" : ""}`} data-selected={selected === thread.id}>
              <Link href={`/inbox/${thread.id}`} onClick={() => setSelected(thread.id)}>
                <span className="from">
                  {thread.isUnread ? <span className="dot" aria-hidden="true" /> : null} {thread.fromName || thread.fromEmail}
                </span>
                <span className="subject">{thread.subject}</span>
                <span className="snippet">{thread.snippet}</span>
                <span className="meta">
                  {new Date(thread.lastMessageAt).toLocaleString()}
                  {thread.category ? ` · ${thread.category}` : ""}
                  {thread.hasAttachments ? " · Attachment" : ""}
                  {thread.isImportant ? " · Important" : ""}
                  {thread.isStarred ? " · Starred" : ""}
                  {thread.isUnread ? " · Unread" : " · Read"}
                </span>
              </Link>
              <div className="row-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={thread.isStarred}
                  aria-label={thread.isStarred ? "Unstar" : "Star"}
                  onClick={() => flags.mutate({ id: thread.id, starred: !thread.isStarred })}
                >
                  ★
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={!thread.isUnread}
                  aria-label={thread.isUnread ? "Mark read" : "Mark unread"}
                  onClick={() => flags.mutate({ id: thread.id, unread: !thread.isUnread })}
                >
                  {thread.isUnread ? "Read" : "New"}
                </button>
                {view !== "sent" ? (
                  <>
                    <Button type="button" onClick={() => setPending({ thread, action: "archive" })}>
                      Archive
                    </Button>
                    <Button type="button" variant="danger" onClick={() => setPending({ thread, action: "trash" })}>
                      Trash
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <aside className="surface">
          <h2>This page</h2>
          <p className="hint">Selection highlights a conversation. Archive and Trash still ask for that one thread. There is no bulk action.</p>
          <p>{visible.length} shown</p>
          {next ? (
            <Button
              type="button"
              onClick={() => setCursor(next)}
              disabled={active.isFetching}
            >
              {active.isFetching ? "Loading" : "Load next page"}
            </Button>
          ) : (
            <p className="hint">No further page token from this source.</p>
          )}
        </aside>
      </div>
      <ConfirmDialog
        open={Boolean(pending)}
        pending={act.isPending}
        title={pending?.action === "trash" ? "Move this conversation to Trash?" : "Archive this conversation?"}
        body={
          pending
            ? `${pending.thread.subject}. ${
                pending.action === "trash"
                  ? "FLUENT moves it to Trash and does not permanently delete it."
                  : "It leaves the inbox and stays available in All Mail."
              }`
            : ""
        }
        confirmLabel={pending?.action === "trash" ? "Move to Trash" : "Archive"}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && act.mutate(pending)}
      />
      {act.isError ? <ErrorState message={act.error instanceof ApiClientError ? act.error.message : "The action failed"} /> : null}
      {flags.isError ? <ErrorState message="Could not update read or star state." /> : null}
    </section>
  );
}
