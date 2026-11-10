// Bundled on its own by scripts/check-serverless-mail.mjs and run with no node_modules, like a Vercel Function.
import { smtpSend, withImap, type ImapCredentials } from "../../server/providers/imap.js";

const creds = (imapHost: string, smtpHost: string, password: string): ImapCredentials => ({
  username: "robin@mail.fluent.test", password, imap: { host: imapHost, port: 993 }, smtp: { host: smtpHost, port: 465 },
});

/** One "invocation": open IMAP, read INBOX, close; send one message over SMTP. */
export async function invoke(password: string): Promise<{ messages: number; subjects: string[] }> {
  const c = creds("imap.mail.fluent.test", "smtp.mail.fluent.test", password);
  const r = await withImap(c, async (imap) => {
    const lock = await imap.getMailboxLock("INBOX", { readOnly: true });
    try {
      const subjects: string[] = [];
      for await (const m of imap.fetch("1:*", { envelope: true })) subjects.push(m.envelope?.subject ?? "");
      return { messages: subjects.length, subjects };
    } finally {
      lock.release();
    }
  });
  await smtpSend(c, { from: c.username, to: ["ola@example.org"] }, "From: robin@mail.fluent.test\r\nTo: ola@example.org\r\nSubject: probe\r\n\r\nhi\r\n");
  return r;
}

export async function blocked(): Promise<string[]> {
  const out: string[] = [];
  for (const [h, p] of [["localhost", 993], ["imap.example.com", 143]] as const) {
    try { await withImap({ ...creds(h, h, "x"), imap: { host: h, port: p } }, async () => undefined); out.push("connected"); } catch (e) { out.push((e as { code?: string }).code ?? "error"); }
  }
  return out;
}
