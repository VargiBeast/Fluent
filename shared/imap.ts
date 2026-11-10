import { z } from "zod";

/** Ports FLUENT will connect to: IMAP over TLS, SMTP over TLS, SMTP submission with STARTTLS. */
export const IMAP_PORTS = [993] as const;
export const SMTP_PORTS = [465, 587] as const;

export interface MailServerPreset {
  id: "icloud" | "yahoo" | "fastmail";
  label: string;
  imap: { host: string; port: 993 };
  smtp: { host: string; port: 465 | 587 };
  /** Where the user creates an app password. */
  appPasswordUrl: string;
}

export const IMAP_PRESETS: MailServerPreset[] = [
  { id: "icloud", label: "iCloud Mail", imap: { host: "imap.mail.me.com", port: 993 }, smtp: { host: "smtp.mail.me.com", port: 587 }, appPasswordUrl: "https://account.apple.com/account/manage" },
  { id: "yahoo", label: "Yahoo Mail", imap: { host: "imap.mail.yahoo.com", port: 993 }, smtp: { host: "smtp.mail.yahoo.com", port: 465 }, appPasswordUrl: "https://login.yahoo.com/account/security" },
  { id: "fastmail", label: "Fastmail", imap: { host: "imap.fastmail.com", port: 993 }, smtp: { host: "smtp.fastmail.com", port: 465 }, appPasswordUrl: "https://app.fastmail.com/settings/security/apps" },
];

// A DNS hostname (no IP literals, no ports, no userinfo): letters, digits, hyphens, at least one dot.
const hostname = z.string().trim().toLowerCase().max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/, "Enter a server name like imap.example.com");

const server = <P extends readonly number[]>(ports: P) => z.object({
  host: hostname,
  port: z.number().int().refine((p) => (ports as readonly number[]).includes(p), `Port must be ${ports.join(" or ")}`),
}).strict();

export const imapAccountInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(120).default(""),
  /** Login name; most providers use the email address. */
  username: z.string().trim().min(1).max(254).optional(),
  /** An app-specific password. Never returned by the API, stored encrypted. */
  password: z.string().min(1).max(256).refine((s) => !/[\r\n\0]/.test(s), "Invalid password"),
  imap: server(IMAP_PORTS),
  smtp: server(SMTP_PORTS),
}).strict();

export type ImapAccountInput = z.infer<typeof imapAccountInputSchema>;
