import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/fluent/states";
import { useToast } from "@/components/fluent/toast";
import { api, ApiClientError } from "@/lib/api";

interface Draft {
  id: string;
  threadId: string | null;
  kind: string;
  toEmail: string;
  subject: string;
  body: string;
  updatedAt: string;
  sent: false;
}

export function ComposePage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const drafts = useQuery({
    queryKey: ["drafts"],
    queryFn: () => api<{ drafts: Draft[] }>("/api/drafts"),
  });
  const [id, setId] = useState<string | null>(null);
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState({ toEmail: "", subject: "", body: "" });
  const dirty = toEmail !== saved.toEmail || subject !== saved.subject || body !== saved.body;
  const save = useMutation({
    mutationFn: () => {
      const payload = { kind: "compose", toEmail, subject, body };
      if (id) return api<Draft>(`/api/drafts/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      return api<Draft>("/api/drafts", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: async (draft) => {
      setId(draft.id);
      setSaved({ toEmail, subject, body });
      await queryClient.invalidateQueries({ queryKey: ["drafts"] });
      toast.notify({ title: "Draft saved", body: "It stays in FLUENT. Nothing was sent." });
    },
  });
  function openDraft(draft: Draft) {
    setId(draft.id);
    setToEmail(draft.toEmail);
    setSubject(draft.subject);
    setBody(draft.body);
    setSaved({ toEmail: draft.toEmail, subject: draft.subject, body: draft.body });
  }
  return (
    <section data-screen="compose">
      <PageHeader title="Compose" lede="Local drafts only. There is no send control." />
      <div className="card-grid">
        <form
          className="draft-box"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <p className={dirty ? "dirty" : "hint"}>{dirty ? "Unsaved changes" : "All changes saved"}</p>
          <label className="field" htmlFor="compose-to">
            <span>To</span>
            <input id="compose-to" value={toEmail} onChange={(event) => setToEmail(event.target.value)} autoComplete="email" />
          </label>
          <label className="field" htmlFor="compose-subject">
            <span>Subject</span>
            <input id="compose-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <label className="field" htmlFor="compose-body">
            <span>Message</span>
            <textarea id="compose-body" value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <Button variant="primary" type="submit" disabled={save.isPending || !dirty}>
            {save.isPending ? "Saving" : id ? "Update draft" : "Save local draft"}
          </Button>
          {save.isError ? <ErrorState message={save.error instanceof ApiClientError ? save.error.message : "Could not save"} /> : null}
        </form>
        <aside className="surface">
          <h2>Saved drafts</h2>
          {drafts.isLoading ? <LoadingState label="Loading drafts" /> : null}
          {drafts.isError ? <ErrorState message="Could not load drafts." /> : null}
          {!drafts.isLoading && (drafts.data?.drafts.length ?? 0) === 0 ? (
            <EmptyState title="No drafts yet" body="A saved draft will reopen here. It is never sent." />
          ) : null}
          <ul>
            {(drafts.data?.drafts ?? []).map((draft) => (
              <li key={draft.id}>
                <button type="button" className="button secondary" onClick={() => openDraft(draft)}>
                  {draft.subject || "Untitled"} · {draft.kind}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
