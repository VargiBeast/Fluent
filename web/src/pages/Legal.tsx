import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Compass } from "lucide-react";
import { Logo } from "@/components/ui/misc";

/** Operator identity shown on Privacy and Terms. */
export const OPERATOR = "Varg Rodal Kjønø";
/** Public contact for privacy and legal requests. */
export const CONTACT_EMAIL = "contact@mailiq.app";
export const LAST_UPDATED = "November 13, 2026";

export function PublicFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-[12.5px] text-fg-3 sm:flex-row">
        <Logo withText />
        <nav className="flex gap-5">
          <Link to="/privacy" className="hover:text-fg">Privacy</Link>
          <Link to="/terms" className="hover:text-fg">Terms</Link>
          <Link to="/" className="hover:text-fg">Home</Link>
        </nav>
      </div>
    </footer>
  );
}

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · MailIQ`;
    window.scrollTo(0, 0);
    return () => { document.title = "MailIQ"; };
  }, [title]);
  return (
    <div className="dark min-h-full bg-[#08080b] text-fg">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Link to="/" aria-label="MailIQ home"><Logo /></Link>
        <Link to="/" className="flex items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg"><ArrowLeft className="size-4" /> Back</Link>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-6">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[13px] text-fg-3">Last updated {LAST_UPDATED}</p>
        <article className="legal mt-8 space-y-4 text-[14.5px] leading-relaxed text-fg-2">{children}</article>
      </main>
      <PublicFooter />
    </div>
  );
}

const H = ({ children }: { children: ReactNode }) => <h2 className="pt-6 text-[18px] font-semibold text-fg">{children}</h2>;
const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1.5 pl-6">{children}</ul>;

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        This policy explains how MailIQ (“MailIQ”, “we”), operated by <strong className="text-fg">{OPERATOR}</strong>,
        accesses, uses, stores and shares information when you use the MailIQ email client. MailIQ is an interface for
        mailboxes you choose to connect. It reads and changes mail only to show it to you and to carry out the actions you take.
      </p>
      <p>
        Today you can connect <strong className="text-fg">Gmail</strong> (Google), and—when enabled by the operator—
        <strong className="text-fg"> Outlook / Microsoft 365</strong> and optional <strong className="text-fg">IMAP</strong> accounts.
        Sections below describe each connection type. If MailIQ later adds other providers, this policy will be updated before those connections are offered to you.
      </p>

      <H>1. Information we access from connected mail providers</H>

      <p className="font-medium text-fg">Google (Gmail)</p>
      <p>When you sign in with Google, you choose whether to grant the following permissions. MailIQ requests only these:</p>
      <UL>
        <li>
          <strong className="text-fg">Basic profile (openid, email, profile)</strong> — your Google account ID, email address,
          name and profile photo, used to create your MailIQ account and show who is signed in.
        </li>
        <li>
          <strong className="text-fg">Gmail read, compose, send and modify (gmail.modify)</strong> — to show your messages,
          threads, labels and attachments; to send replies and new emails you write; to save drafts; to archive, star,
          mark read/unread, label, report spam and move messages to Trash when you ask. MailIQ cannot permanently delete
          messages through this scope; “Delete” moves mail to Gmail’s Trash.
        </li>
        <li>
          <strong className="text-fg">Gmail basic settings (gmail.settings.basic)</strong> — to list, create and delete
          Gmail filters from MailIQ’s filter settings.
        </li>
      </UL>
      <p>
        You can review or remove MailIQ’s access at any time at{" "}
        <a className="text-accent-ink hover:underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
          myaccount.google.com/permissions
        </a>.
      </p>

      <p className="font-medium text-fg">Microsoft (Outlook / Microsoft 365)</p>
      <p>
        When Microsoft sign-in is enabled and you connect an Outlook or Microsoft 365 mailbox, MailIQ requests these
        Microsoft Graph delegated permissions:
      </p>
      <UL>
        <li><strong className="text-fg">User.Read</strong> — basic profile (id, display name, email) for the connected account.</li>
        <li><strong className="text-fg">Mail.ReadWrite</strong> — read and modify mail in that mailbox so MailIQ can show and organise it as you request.</li>
        <li><strong className="text-fg">Mail.Send</strong> — send mail you compose through MailIQ.</li>
        <li><strong className="text-fg">offline_access</strong> — obtain a refresh token so you stay signed in without re-consenting on every visit.</li>
      </UL>
      <p>
        You can remove MailIQ’s access from your Microsoft account permissions page. Disconnecting the account in MailIQ
        Settings also deletes the stored tokens for that mailbox.
      </p>

      <p className="font-medium text-fg">IMAP (optional)</p>
      <p>
        If you add an IMAP account yourself, MailIQ stores the server details and credentials you provide, encrypted at rest,
        and uses them only to fetch and send mail for that account over IMAP/SMTP. IMAP is separate from Google or Microsoft sign-in.
      </p>

      <H>2. What MailIQ stores</H>
      <UL>
        <li>Your profile (provider account id, email, name, profile photo URL where available).</li>
        <li>
          For each connected account: email address, provider type, granted permissions/scopes, and OAuth access/refresh
          tokens (or IMAP credentials) encrypted with AES-256-GCM.
        </li>
        <li>Your MailIQ settings (appearance, notifications, AI and privacy preferences, AI exclusions).</li>
        <li>Sign-in sessions: a hashed session identifier, browser user-agent and timestamps.</li>
        <li>
          An AI access log (when AI history is not turned off): the time, the AI feature used, and the mailbox thread IDs
          and subjects (encrypted) of the emails the AI read. Email bodies are never written to this log.
        </li>
        <li>A security log of sign-ins, account connections and sensitive setting changes, without email content.</li>
        <li>Short-lived rate-limit counters used to prevent abuse.</li>
        <li>Optional private thread notes and email templates you create, stored encrypted with AES-256-GCM.</li>
        <li>
          Optional lists you create in the product: read-later entries (thread ids and timestamps, no bodies) and snooze
          schedules (thread id and due time).
        </li>
        <li>
          A short-lived encrypted cache of the daily AI brief (subjects, senders and AI reasons for the current day),
          replaced when a new brief is generated and cleared when you clear AI history.
        </li>
        <li>
          Pending Copilot plans (when you use Copilot actions): encrypted action plan including affected subjects and draft
          text, valid only for a short period (on the order of minutes) until you confirm or cancel; unused plans are removed.
        </li>
      </UL>
      <p>
        <strong className="text-fg">MailIQ does not store your email message bodies, attachments or full message content in its database.</strong>{" "}
        They are fetched live from the connected provider when you view them and are held only in memory while a request is
        processed. Drafts you save are stored in your mailbox with the provider (for example Gmail or Outlook), not as a
        permanent copy in MailIQ’s database.
      </p>

      <H>3. How we use your information</H>
      <p>
        We use data from connected mail providers only to provide and improve the user-facing features of MailIQ that you
        see and use: displaying, searching, organising, composing and sending your email, and the AI features described below.
        We do not sell your information or use it to serve third-party advertising.
      </p>

      <H>4. Google API Services User Data Policy and Limited Use</H>
      <p>
        MailIQ’s use and transfer to any other app of information received from GitHub APIs will adhere to the{" "}
        <a className="text-accent-ink hover:underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. In particular:
      </p>
      <UL>
        <li>We use Gmail data only to provide or improve user-facing features that are prominent in MailIQ’s interface.</li>
        <li>
          We do not transfer Gmail data to others except as needed to provide those features (for example, to the AI provider
          when you use an AI feature), to comply with applicable law, or as part of a merger or acquisition with notice to you.
        </li>
        <li>We do not use or transfer Gmail data for serving advertisements, including retargeting, personalised or interest-based advertising.</li>
        <li>We do not sell Gmail data, and we do not use it to determine creditworthiness or for lending purposes.</li>
        <li>
          No human reads your Gmail data unless you give explicit consent for specific messages, it is necessary for security
          purposes (such as investigating abuse), to comply with law, or the data is aggregated and anonymised for internal operations.
        </li>
        <li>We do not use Gmail data to develop, improve or train generalised or non-personalised AI or machine-learning models.</li>
      </UL>

      <H>5. AI features and Google Gemini</H>
      <p>
        MailIQ’s AI features (for example summaries, explanations, drafting, rewriting, natural-language search, “Ask your inbox”,
        Copilot and the AI Overview) send the content needed for that request to an AI provider. By default this is{" "}
        <strong className="text-fg">Google’s Gemini API</strong> (Google AI / Generative AI API). The operator may configure
        xAI (Grok) or OpenAI instead. AI runs when you use an AI feature, and also automatically when you open a conversation
        if “Summarize emails automatically” is on, or when you open the AI Overview.
      </p>
      <UL>
        <li>Only the emails or fields relevant to your request are sent. For the AI Overview, only subjects and short snippets are sent.</li>
        <li>
          The provider processes requests under its own terms and privacy policy. For xAI and OpenAI API calls, MailIQ disables
          the provider’s request-storage option where the API offers that control. For Gemini, Google processes prompts and
          responses according to Google’s Generative AI / Gemini API terms for the API tier the operator uses. Those terms may
          allow limited retention for abuse monitoring and, on some tiers, different product-improvement practices. Review
          Google’s current API terms for details.
        </li>
        <li>You can turn AI off entirely, and you can exclude senders, domains and labels. Exclusions are enforced on MailIQ’s servers before any request reaches the AI.</li>
        <li>
          Email content is treated as untrusted data. The AI cannot send, delete, forward or change email on its own. Copilot
          can propose actions (such as archiving, labelling, moving to Trash, drafting or sending), but it shows you the plan
          first, and nothing happens until you confirm. Moving to Trash and sending need an extra confirmation. A pending plan
          is stored encrypted for a short time only and is erased when you confirm or cancel, or when it expires.
        </li>
        <li>MailIQ does not permanently store AI prompts or model responses in its application database. The AI access log in Settings → Privacy shows which emails were read for AI features, and you can clear it at any time.</li>
      </UL>

      <H>6. Sharing and service providers</H>
      <p>We do not sell your information. We share it only with service providers that process it on our behalf to run MailIQ:</p>
      <UL>
        <li>Google — authentication and the Gmail API when you use Gmail; and the Gemini API when AI is enabled with the default provider.</li>
        <li>Microsoft — authentication and Microsoft Graph when you connect Outlook / Microsoft 365.</li>
        <li>Vercel — application hosting and Vercel Web Analytics. Analytics counts page views without using cookies for that purpose. It only receives a generic page path (for example “/app/inbox” or “/app/inbox/thread”), never email content, addresses, search terms, label names or thread ids.</li>
        <li>Managed PostgreSQL hosting (for example Supabase or an equivalent provider configured by the operator) — stores the data listed in section 2.</li>
        <li>xAI or OpenAI — only if the operator configures one of them as the AI provider, and only for AI requests you trigger (or that automatic summary settings cause).</li>
      </UL>
      <p>We may disclose information if required by law or to protect the security of MailIQ and its users.</p>

      <H>7. Retention and deletion</H>
      <UL>
        <li>OAuth tokens and IMAP credentials are kept until you disconnect the account or delete your MailIQ data. Disconnecting revokes the token at the provider where the provider supports revocation, and deletes the stored secrets.</li>
        <li>The AI access log is kept for the period you choose in settings (default 30 days; setting the retention to off records nothing further).</li>
        <li>Sessions expire after the configured session lifetime (default 30 days after sign-in), or earlier when you sign out or revoke sessions.</li>
        <li>Daily brief cache entries are replaced when a new brief is generated and are cleared when you clear AI history.</li>
        <li>Pending Copilot plans expire within minutes if not confirmed.</li>
        <li>Your profile, settings and security log are kept until you delete your data.</li>
        <li>
          Settings → Your data lets you export what MailIQ stores as JSON (OAuth tokens are excluded from exports) and permanently
          delete your account. Deletion revokes provider access for connected accounts where supported and removes application
          records. Encrypted backups held by infrastructure providers follow those providers’ own backup schedules.
        </li>
        <li>Application logs are configured not to include email bodies; retention follows the hosting provider’s log settings.</li>
      </UL>

      <H>8. Cookies, authentication and security</H>
      <p>
        MailIQ uses an httpOnly session cookie (with the <code className="text-fg">__Host-</code> prefix on HTTPS) to keep you
        signed in, plus a CSRF token for state-changing requests. Session identifiers are stored hashed. OAuth tokens, notes,
        templates, brief payloads and IMAP credentials are encrypted at rest with AES-256-GCM. Traffic uses HTTPS in production.
        Email HTML is sanitised and shown in a sandboxed view; remote images are blocked by default so senders cannot use them
        to track opens through MailIQ. No method of transmission or storage is completely secure.
      </p>

      <H>9. Your rights (including GDPR)</H>
      <p>
        Depending on where you live—for example under the EU/EEA General Data Protection Regulation (GDPR)—you may have rights
        to access, correct, export, delete or restrict processing of your personal data, to object to certain processing, and
        to lodge a complaint with a supervisory authority. You can exercise many of these rights directly in Settings (export,
        delete account, clear AI history, disconnect accounts). For other requests, contact us at the address below. We will
        respond in line with applicable law.
      </p>
      <p>
        MailIQ is operated by {OPERATOR}. For privacy requests use <a className="text-accent-ink hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <H>10. Children</H>
      <p>MailIQ is not directed at children under 16, and we do not knowingly collect their personal data.</p>

      <H>11. Changes</H>
      <p>We will post any changes to this policy on this page and update the date above. Material changes will be highlighted in the app where practical.</p>

      <H>12. Contact</H>
      <p>
        Questions or privacy requests:{" "}
        <a className="text-accent-ink hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        {" "}(operator: {OPERATOR}).
      </p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These terms govern your use of MailIQ, operated by <strong className="text-fg">{OPERATOR}</strong>. By using MailIQ you agree to them.
        Our handling of personal data is described in the{" "}
        <Link to="/privacy" className="text-accent-ink hover:underline">Privacy Policy</Link>.
      </p>

      <H>1. The service</H>
      <p>
        MailIQ is a web email client that connects to mailboxes you authorise—primarily Gmail via Google’s APIs, and, when
        enabled, Outlook / Microsoft 365 via Microsoft Graph and optional IMAP accounts. MailIQ depends on those third-party
        APIs and on infrastructure providers (hosting, database, AI). MailIQ is currently offered as a preview: features may
        change, and the service may be interrupted or discontinued.
      </p>

      <H>2. Your account and mailboxes</H>
      <p>
        You must have the right to use every mailbox you connect. You are responsible for activity in your MailIQ account and
        for keeping access to your Google, Microsoft or IMAP credentials secure. You must follow the terms of Google, Microsoft
        and any other provider whose account you connect.
      </p>

      <H>3. Your email and AI output</H>
      <p>
        You remain responsible for every email you send. AI features can be inaccurate or incomplete: review summaries, answers
        and drafts before relying on or sending them. MailIQ does not send AI-written text without your confirmation.
      </p>

      <H>4. Acceptable use</H>
      <UL>
        <li>Do not use MailIQ to send spam, malware, or unlawful, harassing or deceptive content.</li>
        <li>Do not attempt to access other users’ data, probe or disrupt the service, or bypass security or rate limits.</li>
        <li>Do not misuse connected APIs (including Gmail and Microsoft Graph) in ways that violate the provider’s terms or quotas.</li>
        <li>Do not use MailIQ if you are not allowed to do so under the laws that apply to you.</li>
      </UL>

      <H>5. Service limitations</H>
      <UL>
        <li>MailIQ is not a backup service. Message bodies live with your mail provider; do not rely on MailIQ as the only copy of important mail.</li>
        <li>Availability depends on third parties (Google, Microsoft, hosting, AI providers). Outages or API changes may limit features.</li>
        <li>Provider rate limits, revoked consent or expired tokens can make a mailbox temporarily or permanently unavailable until you reconnect.</li>
      </UL>

      <H>6. Termination</H>
      <p>
        You can stop using MailIQ and delete your data at any time from Settings → Your data. We may suspend or terminate
        access that violates these terms, threatens the service or other users, or is required by law or a provider.
      </p>

      <H>7. Disclaimer and liability</H>
      <p>
        MailIQ is provided “as is” and “as available” without warranties of any kind, whether express or implied, including
        fitness for a particular purpose and non-infringement, to the extent permitted by law. To the extent permitted by law,
        we are not liable for indirect, incidental or consequential damages, or for loss of data, profits or business, arising
        from your use of MailIQ or from third-party services it relies on. Nothing in these terms limits rights you cannot waive
        under mandatory consumer or data-protection law.
      </p>

      <H>8. Changes</H>
      <p>We may update these terms and will post changes on this page with a new date. Continued use after changes take effect constitutes acceptance of the updated terms where permitted by law.</p>

      <H>9. Contact</H>
      <p>
        <a className="text-accent-ink hover:underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        {" "}(operator: {OPERATOR}).
      </p>
    </LegalLayout>
  );
}

export function NotFoundPage() {
  return (
    <div className="dark flex min-h-full flex-col items-center justify-center gap-4 bg-[#08080b] px-6 text-center text-fg">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink"><Compass className="size-6" /></span>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-[14px] text-fg-3">The page you're looking for doesn't exist.</p>
      <Link to="/" className="rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-white">Go home</Link>
    </div>
  );
}
