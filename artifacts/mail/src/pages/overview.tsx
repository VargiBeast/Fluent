import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/fluent/states";
import { api, ApiClientError, type ThreadSummary } from "@/lib/api";
import { useSetup } from "@/lib/session";

const DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b/g;

export function OverviewPage() {
  const setup = useSetup();
  const threads = useQuery({
    queryKey: ["threads", "all"],
    queryFn: () => api<{ threads: ThreadSummary[]; source: string }>("/api/threads?view=all"),
  });
  const overview = useQuery({
    queryKey: ["overview-ai"],
    enabled: setup.data?.ai === "live" || setup.data?.ai === "mock",
    queryFn: () =>
      api<{
        mock: boolean;
        overview: string;
        priorities: Array<{ threadId: string; reason: string }>;
        followUps: Array<{ threadId: string; reason: string }>;
        uncertainty: string;
      }>("/api/ai/overview", { method: "POST", body: "{}" }),
  });
  const rows = threads.data?.threads ?? [];
  const important = rows.filter((thread) => thread.isImportant && thread.isUnread);
  const needs = rows.filter((thread) => thread.needsReply);
  const dates = rows.flatMap((thread) =>
    (thread.snippet.match(DATE) ?? []).map((value) => ({ value, thread })),
  );
  return (
    <section data-screen="overview">
      <PageHeader
        title="Overview"
        lede="Counts come from stored mailbox flags. Narrative text is separate and labeled. Dates below are strings found in stored snippets, not inferred plans."
      />
      {threads.isLoading ? <LoadingState label="Loading overview" /> : null}
      {threads.isError ? <ErrorState message={threads.error instanceof ApiClientError ? threads.error.message : "Overview failed"} /> : null}
      <div className="stat-row">
        <article className="surface">
          <h2>Important unread</h2>
          <p className="stat">{important.length}</p>
        </article>
        <article className="surface">
          <h2>Needs a response</h2>
          <p className="stat">{needs.length}</p>
        </article>
        <article className="surface">
          <h2>Stored</h2>
          <p className="stat">{rows.length}</p>
        </article>
      </div>
      <div className="card-grid">
        <article className="surface">
          <h2>Recent</h2>
          {rows.length === 0 ? <EmptyState title="No conversations yet" body="Refresh the inbox after a demo session or a real connection." /> : null}
          <ul>
            {rows.slice(0, 5).map((thread) => (
              <li key={thread.id}>
                <Link href={`/inbox/${thread.id}`}>{thread.subject}</Link>
              </li>
            ))}
          </ul>
        </article>
        <article className="surface">
          <h2>Dates in the text</h2>
          {dates.length === 0 ? <p className="hint">No explicit date or time was found in the loaded snippets.</p> : null}
          <ul>
            {dates.slice(0, 6).map((item) => (
              <li key={`${item.thread.id}-${item.value}`}>
                <Link href={`/inbox/${item.thread.id}`}>
                  {item.value} · {item.thread.subject}
                </Link>
              </li>
            ))}
          </ul>
        </article>
        <article className="surface">
          <h2>{overview.data?.mock ? "Mock overview" : "AI overview"}</h2>
          {overview.data?.mock ? <p className="badge mock">Mock analysis, not a live model</p> : null}
          {setup.data?.ai === "blocked" ? (
            <p role="status">AI is not configured. No overview has been invented in its place.</p>
          ) : null}
          {overview.isLoading ? <LoadingState label="Preparing overview" /> : null}
          {overview.isError ? <ErrorState message="The overview request failed." /> : null}
          {overview.data ? (
            <>
              <p>{overview.data.overview}</p>
              <p className="hint">{overview.data.uncertainty}</p>
              <h3>Priorities</h3>
              <ul>
                {overview.data.priorities.map((item) => (
                  <li key={item.threadId}>
                    <Link href={`/inbox/${item.threadId}`}>{item.reason}</Link>
                  </li>
                ))}
              </ul>
              <h3>Follow-ups</h3>
              <ul>
                {overview.data.followUps.map((item) => (
                  <li key={item.threadId}>
                    <Link href={`/inbox/${item.threadId}`}>{item.reason}</Link>
                  </li>
                ))}
              </ul>
              <p className="hint">These links open the source conversation. They do not archive or delete it.</p>
            </>
          ) : null}
        </article>
      </div>
    </section>
  );
}
