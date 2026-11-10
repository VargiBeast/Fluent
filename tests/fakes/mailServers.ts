import type { AddressInfo } from "node:net";
import hoodiecrow from "hoodiecrow-imap";
import { SMTPServer } from "smtp-server";

/** A plaintext IMAP fake (hoodiecrow) and SMTP fake (smtp-server) on 127.0.0.1, for *.fluent.test hosts in tests. */
export interface FakeMailServers {
  imapPort: number;
  smtpPort: number;
  sent: Array<{ from: string; to: string[]; raw: string }>;
  close(): Promise<void>;
}

const msg = (from: string, subject: string, body: string, date: string, extra = "") =>
  `From: ${from}\r\nTo: Robin <robin@mail.fluent.test>\r\nSubject: ${subject}\r\nDate: ${date}\r\nMessage-ID: <${subject.replace(/\W+/g, "")}@fluent.test>\r\n${extra}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;

export async function startFakeMailServers(password = "app-pass-1234"): Promise<FakeMailServers> {
  const imap = hoodiecrow({
    plugins: ["id", "special-use", "move", "uidplus", "enable", "sasl-ir", "literalplus", "unselect"],
    id: { name: "fluent-fake-imap" },
    users: { "robin@mail.fluent.test": { password } },
    storage: {
      INBOX: {
        messages: [
          { raw: msg("Ola Nordmann <ola@example.org>", "Lunch on Friday?", "Are you free for lunch on Friday at 12?", "Mon, 9 Nov 2026 10:00:00 +0100"), flags: [], internaldate: "09-Nov-2026 10:00:00 +0100" },
          { raw: msg("Billing <billing@shop.example>", "Your receipt", "Thanks for your order.", "Tue, 10 Nov 2026 08:00:00 +0100"), flags: ["\\Seen"], internaldate: "10-Nov-2026 08:00:00 +0100" },
        ],
      },
      "": {
        separator: "/",
        folders: {
          Sent: { "special-use": "\\Sent" }, Drafts: { "special-use": "\\Drafts" }, Archive: { "special-use": "\\Archive" },
          Junk: { "special-use": "\\Junk" }, Trash: { "special-use": "\\Trash" },
        },
      },
    },
  });
  await new Promise<void>((r) => imap.listen(0, "127.0.0.1", () => r()));
  const sent: FakeMailServers["sent"] = [];
  const smtp = new SMTPServer({
    disabledCommands: ["STARTTLS"],
    allowInsecureAuth: true,
    authMethods: ["PLAIN", "LOGIN"],
    logger: false,
    onAuth(auth, _s, cb) {
      if (auth.username === "robin@mail.fluent.test" && auth.password === password) cb(null, { user: auth.username });
      else cb(Object.assign(new Error("Invalid login"), { responseCode: 535 }));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        sent.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString("utf8") });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r()));
  return {
    imapPort: (imap.address() as AddressInfo).port,
    smtpPort: (smtp.server.address() as AddressInfo).port,
    sent,
    close: async () => {
      await new Promise<void>((r) => smtp.close(() => r()));
      await new Promise<void>((r) => imap.close(() => r()));
    },
  };
}
