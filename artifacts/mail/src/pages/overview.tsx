import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/fluent/shell";
import { api, ApiClientError, type ThreadSummary } from "@/lib/api";
import { useSetup } from "@/lib/session";

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
  const recent = rows.slice(0, 4);
  return (
    <section>
      <PageHeader
        title="Overview"
        lede="A quick read of what is already stored. Counts come from mailbox flags. The narrative is separate and labeled."
      />
      {threads.isLoading ? <LoadingState label="Loading overview" /> : null}
      {threads.isError ? <ErrorState message={threads.error instanceof ApiClientError ? threads.error.message : "Overview failed"} /> : null}
      <div className="stat-row">
        <article className="surface-card">
          <h2>Important unread</h2>
          <p className="stat">{important.length}</p>
        </article>
        <article className="surface-card">
          <h2>Needs a response</h2>
          <p className="stat">{needs.length}</p>
        </article>
        <article className="surface-card">
          <h2>Stored conversations</h2>
          <p className="stat">{rows.length}</p>
        </article>
      </div>
      <div className="card-grid">
        <article className="surface-card">
          <h2>From the mailbox</h2>
          {recent.length === 0 ? <EmptyState title="No conversations yet" body="Refresh the inbox after connecting Gmail or entering the demo." /> : null}
          <ul>
            {recent.map((thread) => (
              <li key={thread.id}>
                <Link href={`/inbox/${thread.id}`}>{thread.subject}</Link>
              </li>
            ))}
          </ul>
        </article>
        <article className="surface-card">
          <h2>{overview.data?.mock ? "Mock overview" : "AI overview"}</h2>
          {setup.data?.ai === "blocked" ? (
            <p role="status">AI is not configured. Set AI_API_KEY for a live model, or AI_PROVIDER=mock for a labeled extractive adapter.</p>
          ) : null}
          {overview.isLoading ? <LoadingState label="Preparing overview" /> : null}
          {overview.data ? (
            <>
              <p>{overview.data.overview}</p>
              <p>{overview.data.uncertainty}</p>
              <ul>
                {overview.data.followUps.map((item) => (
                  <li key={item.threadId}>
                    <Link href={`/inbox/${item.threadId}`}>{item.reason}</Link>
                  </li>
                ))}
              </ul>
              <p>Suggestions stay here. They do not archive or delete anything.</p>
            </>
          ) : null}
        </article>
      </div>
    </section>
  );
}
