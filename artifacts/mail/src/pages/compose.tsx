import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/fluent/shell";
import { api } from "@/lib/api";

export function ComposePage() {
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api("/api/drafts", {
        method: "POST",
        body: JSON.stringify({ kind: "compose", toEmail, subject, body }),
      }),
  });
  return (
    <section>
      <PageHeader title="Compose" lede="This is a local draft. FLUENT has no send button in this MVP." />
      <form
        className="draft-box"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label htmlFor="compose-to">To</label>
        <input id="compose-to" value={toEmail} onChange={(event) => setToEmail(event.target.value)} autoComplete="email" />
        <label htmlFor="compose-subject">Subject</label>
        <input id="compose-subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
        <label htmlFor="compose-body">Message</label>
        <textarea id="compose-body" value={body} onChange={(event) => setBody(event.target.value)} rows={10} />
        <button className="button primary" type="submit">
          Save local draft
        </button>
        {save.isSuccess ? <p role="status">Saved in FLUENT. Not sent.</p> : null}
      </form>
    </section>
  );
}
