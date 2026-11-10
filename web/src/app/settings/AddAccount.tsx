import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Mail, Server } from "lucide-react";
import type { ImapAccountInput, MailServerPreset } from "@shared/imap";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

type Choice = { kind: "google" } | { kind: "preset"; preset: MailServerPreset } | { kind: "other" };

/** "Add account": Google (OAuth) or any IMAP/SMTP mailbox with an app password. */
export function AddAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const { config } = useSession();
  const providers = useQuery({ queryKey: ["mail-providers"], queryFn: () => api.get<{ imapPresets: MailServerPreset[] }>("/mail-accounts/providers"), enabled: open, staleTime: 3600_000 });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setChoice(null);
  };
  const option = "flex w-full items-center gap-3 disabled:cursor-not-allowed disabled:opacity-60 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left text-[13.5px] text-fg hover:border-line-strong";
  return (
    <Dialog open={open} onOpenChange={close} title={choice ? choiceTitle(choice) : "Add an account"} description={choice ? undefined : "FLUENT shows every account in one inbox, and you can switch between them in the sidebar."}>
      {!choice ? (
        <div className="space-y-2">
          <button type="button" className={option} onClick={() => { window.location.href = "/api/auth/google/start?mode=link"; }}>
            <Mail className="size-4 text-fg-3" aria-hidden /> Gmail or Google Workspace
          </button>
          <button type="button" className={option} disabled={!config?.microsoft} aria-describedby={config?.microsoft ? undefined : "outlook-not-configured"}
            onClick={() => { window.location.href = "/api/auth/microsoft/start"; }}>
            <Mail className="size-4 text-fg-3" aria-hidden />
            <span className="flex-1">Outlook or Microsoft 365</span>
            {!config?.microsoft && <span id="outlook-not-configured" className="text-[12px] text-fg-3">Not configured</span>}
          </button>
          {(providers.data?.imapPresets ?? []).map((p) => (
            <button key={p.id} type="button" className={option} onClick={() => setChoice({ kind: "preset", preset: p })}>
              <Mail className="size-4 text-fg-3" aria-hidden /> {p.label}
            </button>
          ))}
          <button type="button" className={option} onClick={() => setChoice({ kind: "other" })}>
            <Server className="size-4 text-fg-3" aria-hidden /> Other mail (IMAP/SMTP)
          </button>
        </div>
      ) : choice.kind === "google" ? null : (
        <ImapForm choice={choice} onBack={() => setChoice(null)} onDone={() => close(false)} />
      )}
    </Dialog>
  );
}

function choiceTitle(c: Choice): string {
  return c.kind === "preset" ? `Connect ${c.preset.label}` : "Connect another mailbox";
}

function ImapForm({ choice, onBack, onDone }: { choice: Exclude<Choice, { kind: "google" }>; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const preset = choice.kind === "preset" ? choice.preset : null;
  const [f, setF] = useState({ email: "", name: "", username: "", password: "", imapHost: "", smtpHost: "", smtpPort: "465" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const connect = useMutation({
    mutationFn: () => {
      const body: ImapAccountInput = {
        email: f.email.trim(),
        name: f.name.trim(),
        ...(f.username.trim() ? { username: f.username.trim() } : {}),
        password: f.password.replace(/\s+/g, preset ? "" : " ").trim(),
        imap: preset ? preset.imap : { host: f.imapHost.trim(), port: 993 },
        smtp: preset ? preset.smtp : { host: f.smtpHost.trim(), port: Number(f.smtpPort) },
      };
      return api.post("/mail-accounts/imap", body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["session"] });
      void qc.invalidateQueries({ queryKey: ["threads"] });
      toast.success(`${f.email} is connected`);
      onDone();
    },
    onError: (e) => toast.error("Couldn't connect", { description: errorMessage(e) }),
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); connect.mutate(); }}>
      <p className="text-[12.5px] text-fg-3">
        Use an <strong className="text-fg-2">app password</strong>, not your normal password.
        {preset && <> Create one in your <a href={preset.appPasswordUrl} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline">{preset.label} account settings</a>.</>}
        {" "}It's stored encrypted and only used to read and send your mail.
      </p>
      <Field label="Email address">{(id) => <Input id={id} type="email" autoComplete="email" required value={f.email} onChange={set("email")} />}</Field>
      <Field label="Your name (shown to recipients)">{(id) => <Input id={id} autoComplete="name" value={f.name} onChange={set("name")} />}</Field>
      <Field label="App password">{(id) => <Input id={id} type="password" autoComplete="new-password" required value={f.password} onChange={set("password")} />}</Field>
      {!preset && (
        <>
          <Field label="Username" hint="Leave empty to use the email address.">{(id) => <Input id={id} autoComplete="username" value={f.username} onChange={set("username")} />}</Field>
          <Field label="IMAP server (port 993, TLS)">{(id) => <Input id={id} required placeholder="imap.example.com" value={f.imapHost} onChange={set("imapHost")} />}</Field>
          <Field label="SMTP server">{(id) => <Input id={id} required placeholder="smtp.example.com" value={f.smtpHost} onChange={set("smtpHost")} />}</Field>
          <Field label="SMTP port">{(id) => (
            <select id={id} value={f.smtpPort} onChange={set("smtpPort")} className="h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-[13px] text-fg">
              <option value="465">465 (TLS)</option>
              <option value="587">587 (STARTTLS)</option>
            </select>
          )}</Field>
        </>
      )}
      <div className="flex justify-between gap-2 pt-1">
        <Button icon={<ArrowLeft className="size-3.5" />} onClick={onBack}>Back</Button>
        <Button type="submit" variant="primary" loading={connect.isPending}>Connect</Button>
      </div>
    </form>
  );
}
