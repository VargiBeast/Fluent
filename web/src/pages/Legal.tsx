import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Compass } from "lucide-react";
import { Logo } from "@/components/ui/misc";

/**
 * OWNER ACTION: replace these placeholders before publishing or submitting for Google OAuth verification.
 * They are rendered visibly so an unfilled policy is obvious.
 */
export const OPERATOR = "[Operator name — to be filled in by the owner]";
export const CONTACT_EMAIL = "[contact email — to be filled in by the owner]";
export const LAST_UPDATED = "November 10, 2026";

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
    document.title = `${title} · FLUENT`;
    window.scrollTo(0, 0);
    return () => { document.title = "FLUENT"; };
  }, [title]);
  return (
    <div className="dark min-h-full bg-[#08080b] text-fg">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Link to="/" aria-label="FLUENT home"><Logo /></Link>
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
const Placeholder = ({ children }: { children: ReactNode }) => <mark className="rounded bg-warning/20 px-1 text-warning">{children}</mark>;

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        This policy explains how FLUENT (“FLUENT”, “we”), operated by <Placeholder>{OPERATOR}</Placeholder>, accesses, uses, stores and shares your information when you use the FLUENT email client. FLUENT is an interface for your own Gmail account: it reads and changes your mail only to show it to you and to carry out the actions you take.
      </p>

      <H>1. Information we access from Google</H>
      <p>When you sign in with Google, you choose whether to grant the following permissions. FLUENT requests only these:</p>
      <UL>
        <li><strong className="text-fg">Basic profile (openid, email, profile)</strong> — your Google account ID, email address, name and profile photo, used to create your FLUENT account and show who is signed in.</li>
        <li><strong className="text-fg">Gmail read, compose, send and modify (gmail.modify)</strong> — to show your messages, threads, labels and attachments; to send replies and new emails you write; to save drafts; to archive, star, mark read/unread, label, report spam and move messages to Trash when you ask. FLUENT cannot permanently delete messages; “Delete” moves mail to Gmail's Trash.</li>
        <li><strong className="text-fg">Gmail basic settings (gmail.settings.basic)</strong> — to list, create and delete Gmail filters from FLUENT's filter settings.</li>
      </UL>
      <p>You can review or remove FLUENT's access at any time at <a className="text-accent-ink hover:underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.</p>

      <H>2. What FLUENT stores</H>
      <UL>
        <li>Your profile (Google account ID, email, name, profile photo URL).</li>
        <li>For each connected Gmail account: its email address, the permissions granted, and OAuth access/refresh tokens encrypted with AES-256-GCM.</li>
        <li>Your FLUENT settings (appearance, notifications, AI and privacy preferences, AI exclusions).</li>
        <li>Sign-in sessions: a hashed session identifier, your browser's user-agent and timestamps.</li>
        <li>An AI access log (if enabled): the time, the AI feature used, and the Gmail thread IDs and subjects (encrypted) of the emails the AI read. Email bodies are never logged.</li>
        <li>A security log of sign-ins, account connections and sensitive setting changes, without email content.</li>
        <li>Short-lived rate-limit counters used to prevent abuse.</li>
      </UL>
      <p><strong className="text-fg">FLUENT does not store your email messages, bodies, attachments or contacts.</strong> They are fetched from Gmail when you view them and are held only in memory while a request is processed. Drafts you save are stored in your Gmail account, not by FLUENT.</p>

      <H>3. How we use your information</H>
      <p>We use Google user data only to provide and improve the user-facing features of FLUENT that you see and use: displaying, searching, organising, composing and sending your email, and the AI features described below. We do not use it for anything else.</p>

      <H>4. Google API Services User Data Policy and Limited Use</H>
      <p>
        FLUENT's use and transfer to any other app of information received from Google APIs will adhere to the{" "}
        <a className="text-accent-ink hover:underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. In particular:
      </p>
      <UL>
        <li>We use Gmail data only to provide or improve user-facing features that are prominent in FLUENT's interface.</li>
        <li>We do not transfer Gmail data to others except as needed to provide those features (for example, to the AI provider when you use an AI feature), to comply with applicable law, or as part of a merger or acquisition with your notice.</li>
        <li>We do not use or transfer Gmail data for serving advertisements, including retargeting, personalised or interest-based advertising.</li>
        <li>We do not sell Gmail data, and we do not use it to determine creditworthiness or for lending purposes.</li>
        <li>No human reads your Gmail data unless you give explicit consent for specific messages, it is necessary for security purposes (such as investigating abuse), to comply with law, or the data is aggregated and anonymised for internal operations.</li>
        <li>We do not use Gmail data to develop, improve or train generalised or non-personalised AI or machine-learning models.</li>
      </UL>

      <H>5. AI features</H>
      <p>
        FLUENT's AI features (summaries, explanations, drafting, rewriting, natural-language search, “Ask your inbox”, Copilot and the AI Overview) send the content needed for that request to an AI provider. By default this is Google's Gemini API (Google AI Studio). The operator may configure xAI (Grok) or OpenAI instead. AI runs when you use an AI feature, and also automatically when you open a conversation if “Summarize emails automatically” is on, or when you open the AI Overview.
      </p>
      <UL>
        <li>Only the emails relevant to your request are sent. For the AI Overview, only subjects and short snippets are sent.</li>
        <li>The provider processes requests under its own API terms. With xAI and OpenAI, FLUENT turns the API's request-storage option off. With Gemini, Google keeps prompts and responses for a limited time to detect abuse. If the operator uses Gemini's free (unpaid) tier, Google may also use them to improve its products, and human reviewers may read them. On the paid tier Google does not use them for that.</li>
        <li>You can turn AI off entirely, and you can exclude senders, domains and labels. Exclusions are enforced on FLUENT's server before any request reaches the AI.</li>
        <li>Email content is treated as untrusted data. The AI cannot send, delete, forward or change email on its own. Copilot can propose actions (such as archiving, labelling, moving to Trash, drafting or sending), but it shows you the exact plan first, and nothing happens until you confirm it. Moving to Trash and sending need an extra confirmation. Copilot's planning step sees only your instruction, never your email content. A pending plan, including the affected subjects and draft text, is stored encrypted and can only be confirmed within 10 minutes. Its contents are erased as soon as you confirm or cancel it. An abandoned plan is deleted the next time anyone uses Copilot, and always when you delete your data.</li>
        <li>FLUENT does not store AI prompts or responses. The AI access log in Settings → Privacy shows which emails were read, and you can clear it at any time.</li>
      </UL>

      <H>6. Sharing and service providers</H>
      <p>We do not sell your information. We share it only with service providers that process it on our behalf to run FLUENT:</p>
      <UL>
        <li>Google (authentication and the Gmail API).</li>
        <li>Vercel Web Analytics, which counts page views without cookies. It only ever receives a generic page path such as “/app/inbox” or “/app/inbox/thread”, never email content, addresses, search terms, label names or thread ids.</li>
        <li>Our hosting provider (Vercel) and database provider (managed PostgreSQL, e.g. Supabase), which store the data listed in section 2.</li>
        <li>The AI provider (Google, through the Gemini API, by default; or xAI or OpenAI if the operator configures them), only for AI requests you make.</li>
      </UL>
      <p>We may disclose information if required by law or to protect the security of FLUENT and its users.</p>

      <H>7. Retention and deletion</H>
      <UL>
        <li>OAuth tokens are kept until you disconnect the account or delete your data. Disconnecting revokes FLUENT's token at Google and deletes it.</li>
        <li>The AI access log is kept for the period you choose (default 30 days; “Off” records nothing).</li>
        <li>Sessions expire 30 days after sign-in, or earlier when you sign out or revoke them.</li>
        <li>Your profile, settings and security log are kept until you delete your data.</li>
        <li>Settings → Your data lets you export everything FLUENT stores as JSON and permanently delete it. Deletion revokes Google access for every connected account and removes all records immediately. Encrypted database backups held by our providers expire on their normal schedule.</li>
        <li>Application logs never contain email bodies and are retained according to our hosting provider's log retention.</li>
      </UL>

      <H>8. Security</H>
      <p>FLUENT uses HTTPS, encrypts OAuth tokens at rest, uses httpOnly secure cookies with CSRF protection, isolates each user's data, sanitises email HTML in a sandbox, and blocks remote images by default. No method of transmission or storage is completely secure, but we work to protect your data.</p>

      <H>9. Your rights</H>
      <p>Depending on where you live (for example under the GDPR), you may have the right to access, correct, export, delete or restrict processing of your personal data, and to complain to a data-protection authority. You can exercise most of these directly in Settings, or contact us.</p>

      <H>10. Children</H>
      <p>FLUENT is not directed at children under 16, and we do not knowingly collect their data.</p>

      <H>11. Changes</H>
      <p>We will post any changes to this policy on this page and update the date above. Material changes will be highlighted in the app.</p>

      <H>12. Contact</H>
      <p>Questions or requests: <Placeholder>{CONTACT_EMAIL}</Placeholder>.</p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <p>These terms govern your use of FLUENT, operated by <Placeholder>{OPERATOR}</Placeholder>. By using FLUENT you agree to them.</p>
      <H>1. The service</H>
      <p>FLUENT is an email client that connects to your Gmail account through Google's APIs. FLUENT is currently in preview: features may change, and the service may be interrupted.</p>
      <H>2. Your account</H>
      <p>You must have the right to use the Google accounts you connect. You are responsible for activity in your FLUENT account and for keeping access to your Google account secure. Our use of your data is described in the <Link to="/privacy" className="text-accent-ink hover:underline">Privacy Policy</Link>.</p>
      <H>3. Your email and AI output</H>
      <p>You remain responsible for every email you send. AI features can be inaccurate or incomplete: review summaries, answers and drafts before relying on or sending them. FLUENT never sends AI-written text without your confirmation.</p>
      <H>4. Acceptable use</H>
      <UL>
        <li>Don't use FLUENT to send spam, malware, or unlawful, harassing or deceptive content.</li>
        <li>Don't attempt to access other users' data, probe or disrupt the service, or bypass its security or rate limits.</li>
        <li>Follow Google's terms and policies for your Google account.</li>
      </UL>
      <H>5. Termination</H>
      <p>You can stop using FLUENT and delete your data at any time from Settings → Your data. We may suspend access that violates these terms or threatens the service.</p>
      <H>6. Disclaimer and liability</H>
      <p>FLUENT is provided “as is” without warranties of any kind. To the extent permitted by law, we are not liable for indirect or consequential damages, or for loss of data, arising from your use of FLUENT. Nothing in these terms limits rights you have under mandatory consumer law.</p>
      <H>7. Changes</H>
      <p>We may update these terms and will post changes here with a new date.</p>
      <H>8. Contact</H>
      <p><Placeholder>{CONTACT_EMAIL}</Placeholder></p>
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
