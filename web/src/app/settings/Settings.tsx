import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Bell, Download, FileStack, PenLine, Eye, KeyRound, LogOut, Mail, Menu, Palette, Plus, RefreshCw, Shield, Tags, ShieldCheck, Sparkles, Trash2, User, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useSession, type Account } from "@/lib/session";
import { aiProviderName } from "@/lib/ai";
import { useUpdateSettings } from "@/lib/settings";
import { useLabels } from "@/lib/mail";
import { cn } from "@/lib/cn";
import { fullDate, relative } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Switch, Textarea } from "@/components/ui/Field";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Badge, Skeleton } from "@/components/ui/misc";
import { SidebarContext } from "../AppLayout";
import { LabelsFiltersSection } from "./LabelsFilters";
import { TemplatesSection } from "./Templates";
import { SignaturesSection } from "./Signatures";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "accounts", label: "Accounts", icon: Mail },
  { id: "signatures", label: "Signatures & name", icon: PenLine },
  { id: "labels", label: "Labels & filters", icon: Tags },
  { id: "templates", label: "Templates", icon: FileStack },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "ai", label: "AI preferences", icon: Sparkles },
  { id: "privacy", label: "Privacy", icon: Eye },
  { id: "security", label: "Security", icon: Shield },
  { id: "data", label: "Your data", icon: KeyRound },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  if (!section) return <SettingsIndex />;
  const meta = SECTIONS.find((s) => s.id === section);
  if (!meta) return <Navigate to="/app/settings/profile" replace />;
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Settings sections" className="hidden w-[230px] shrink-0 border-r border-line bg-surface px-3 py-4 md:block">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-3">Settings</p>
        {SECTIONS.map((s) => (
          <NavLink key={s.id} to={`/app/settings/${s.id}`} className={({ isActive }) => cn("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]", isActive ? "bg-accent-soft font-medium text-fg" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}>
            <s.icon className="size-4 text-fg-3" />{s.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3 md:px-8">
          <IconButton label="Back to settings" className="md:hidden" onClick={() => navigate("/app/settings")}><ArrowLeft className="size-5" /></IconButton>
          <IconButton label="Open navigation" className="hidden md:inline-flex lg:hidden" onClick={() => SidebarContext.open()}><Menu className="size-5" /></IconButton>
          <h1 className="text-[17px] font-semibold text-fg">{meta.label}</h1>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-8">
            <Section id={meta.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsIndex() {
  const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  if (isDesktop) return <Navigate to="/app/settings/profile" replace />;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <IconButton label="Open navigation" onClick={() => SidebarContext.open()}><Menu className="size-5" /></IconButton>
        <h1 className="text-[17px] font-semibold text-fg">Settings</h1>
      </header>
      <nav aria-label="Settings sections" className="divide-y divide-line">
        {SECTIONS.map((s) => (
          <Link key={s.id} to={`/app/settings/${s.id}`} className="flex items-center gap-3 px-4 py-3.5 text-[14px] text-fg hover:bg-surface-2">
            <s.icon className="size-4 text-accent-ink" />{s.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Section({ id }: { id: SectionId }) {
  switch (id) {
    case "profile": return <ProfileSection />;
    case "accounts": return <AccountsSection />;
    case "signatures": return <SignaturesSection />;
    case "labels": return <LabelsFiltersSection />;
    case "templates": return <TemplatesSection />;
    case "appearance": return <AppearanceSection />;
    case "notifications": return <NotificationsSection />;
    case "ai": return <AiSection />;
    case "privacy": return <PrivacySection />;
    case "security": return <SecuritySection />;
    case "data": return <DataSection />;
  }
}

function Panel({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[14.5px] font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-fg-3">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="px-5 py-3">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn("h-8 rounded-md px-3 text-[13px]", value === o.value ? "bg-surface-3 font-medium text-fg shadow-sm" : "text-fg-3 hover:text-fg")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-[13.5px] font-medium text-fg">{label}</p>
        {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function useSettingsData() {
  const { session } = useSession();
  return { s: session!.settings!, update: useUpdateSettings() };
}

// ---------------- Profile ----------------
function ProfileSection() {
  const { session } = useSession();
  const { s, update } = useSettingsData();
  const [name, setName] = useState(s.profile.displayName);
  const user = session!.user!;
  return (
    <Panel title="Profile" description="How you appear in FLUENT. Your Google account name is used if left empty.">
      <div className="flex items-center gap-4 py-3">
        <Avatar name={user.name} email={user.email} src={user.picture} size={56} />
        <div>
          <p className="text-[15px] font-semibold text-fg">{s.profile.displayName || user.name}</p>
          <p className="text-[13px] text-fg-3">{user.email}</p>
        </div>
      </div>
      <form className="flex items-end gap-2 py-3" onSubmit={(e) => { e.preventDefault(); update.mutate({ profile: { displayName: name.trim() } }, { onSuccess: () => toast.success("Profile saved") }); }}>
        <div className="flex-1">
          <Field label="Display name">{(id) => <Input id={id} value={name} maxLength={120} placeholder={user.name} onChange={(e) => setName(e.target.value)} />}</Field>
        </div>
        <Button type="submit" variant="primary" loading={update.isPending} disabled={name.trim() === s.profile.displayName}>Save</Button>
      </form>
    </Panel>
  );
}

// ---------------- Accounts ----------------
function AccountsSection() {
  const { session, refresh } = useSession();
  const [params, setParams] = useSearchParams();
  const [remove, setRemove] = useState<Account | null>(null);
  const qc = useQueryClient();
  useEffect(() => {
    if (params.get("connected")) toast.success("Gmail account connected");
    if (params.get("error") === "insufficient_scopes") toast.error("Gmail access wasn't granted", { description: "Tick the Gmail permission checkbox on Google's consent screen so FLUENT can read and organise your mail." });
    if (params.has("connected") || params.has("error")) setParams({}, { replace: true });
  }, [params, setParams]);
  const del = useMutation({
    mutationFn: (a: Account) => api.del<{ revokedAtGoogle: boolean }>(`/accounts/${a.id}`),
    onSuccess: async (r, a) => {
      toast.success(`Disconnected ${a.email}`, { description: r.revokedAtGoogle ? "Access was revoked at Google." : "Removed from FLUENT. Google didn't confirm revocation — you can also remove access at myaccount.google.com/permissions." });
      setRemove(null);
      await refresh();
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const accounts = session?.accounts ?? [];
  return (
    <>
      <Panel
        title="Connected Gmail accounts"
        description="FLUENT shows mail from every connected account in one unified inbox."
        actions={<Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => { window.location.href = "/api/auth/google/start?mode=link"; }}>Connect account</Button>}
      >
        {accounts.length === 0 ? (
          <p className="py-4 text-[13px] text-fg-3">No Gmail accounts connected.</p>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={a.name} email={a.email} src={a.picture} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-fg">{a.email}</p>
                  <p className="text-xs text-fg-3">Connected {relative(a.createdAt)}</p>
                </div>
                {a.status === "active" ? <Badge tone="muted">Active</Badge> : <Badge tone="danger">{a.status === "needs_reauth" ? "Needs sign-in" : "Missing Gmail permission"}</Badge>}
                {a.status !== "active" && (
                  <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => { window.location.href = `/api/auth/google/start?mode=link&account=${a.id}`; }}>Reconnect</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setRemove(a)}>Disconnect</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ConfirmDialog
        open={Boolean(remove)}
        onOpenChange={(o) => !o && setRemove(null)}
        title={`Disconnect ${remove?.email ?? ""}?`}
        description="FLUENT will revoke its Google access token and delete the stored tokens for this account. Your Gmail itself is not changed."
        confirmLabel="Disconnect"
        danger
        loading={del.isPending}
        onConfirm={() => remove && del.mutate(remove)}
      />
    </>
  );
}

// ---------------- Appearance ----------------
function AppearanceSection() {
  const { s, update } = useSettingsData();
  return (
    <Panel title="Appearance">
      <Row label="Theme" description="Dark is FLUENT's default.">
        <Segmented label="Theme" value={s.appearance.theme} onChange={(theme) => update.mutate({ appearance: { theme } })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
      </Row>
      <Row label="Density" description="Compact fits more conversations on screen.">
        <Segmented label="Density" value={s.appearance.density} onChange={(density) => update.mutate({ appearance: { density } })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
      </Row>
      <Row label="Reading pane" description="Open emails next to the list, or full width.">
        <Segmented label="Reading pane" value={s.appearance.readingPane} onChange={(readingPane) => update.mutate({ appearance: { readingPane } })} options={[{ value: "right", label: "Right" }, { value: "full", label: "Full" }]} />
      </Row>
      <Row label="Undo send" description="Wait a few seconds before sending, so you can take it back.">
        <Segmented label="Undo send" value={s.compose.undoSendSeconds} onChange={(undoSendSeconds) => update.mutate({ compose: { undoSendSeconds } })} options={[{ value: "0", label: "Off" }, { value: "5", label: "5 s" }, { value: "10", label: "10 s" }, { value: "20", label: "20 s" }]} />
      </Row>
    </Panel>
  );
}

// ---------------- Notifications ----------------
function NotificationsSection() {
  const { s, update } = useSettingsData();
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : "denied");
  const enableDesktop = async (v: boolean) => {
    if (v && supported && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") {
        toast.error("Notifications are blocked in your browser");
        return;
      }
    }
    update.mutate({ notifications: { desktop: v } });
  };
  return (
    <Panel title="Notifications" description="FLUENT checks Gmail for changes about every 45 seconds while it's open.">
      <Switch label="In-app alerts" description="Show a toast when new mail arrives." checked={s.notifications.inApp} onChange={(inApp) => update.mutate({ notifications: { inApp } })} />
      <Switch label="Desktop notifications" description={!supported ? "Not supported in this browser." : perm === "denied" ? "Blocked in your browser settings." : "Notify you with a system notification."} checked={s.notifications.desktop} disabled={!supported} onChange={(v) => void enableDesktop(v)} />
    </Panel>
  );
}

// ---------------- AI ----------------
function AiSection() {
  const { config } = useSession();
  const { s, update } = useSettingsData();
  const [sig, setSig] = useState(s.ai.signature);
  const [lang, setLang] = useState(s.ai.language === "auto" ? "" : s.ai.language);
  return (
    <>
      {!config?.ai && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-[13px] text-fg-2">AI isn’t configured on this server (no provider key). These preferences are saved and take effect once AI is set up.</div>
      )}
      <Panel title="AI features" description={`Provider: ${aiProviderName(config?.aiProvider)}${config?.aiModel ? ` (${config.aiModel})` : ""}. AI only drafts and explains — it can never send, delete or forward email on its own.`}>
        <Switch label="Enable AI" description="Turns off every AI feature and stops all AI requests when disabled." checked={s.ai.enabled} onChange={(enabled) => update.mutate({ ai: { enabled } })} />
        <Switch label="Summarize emails automatically" description="Generate a summary when you open a conversation. When off, click Summarize instead." checked={s.ai.autoSummarize} disabled={!s.ai.enabled} onChange={(autoSummarize) => update.mutate({ ai: { autoSummarize } })} />
      </Panel>
      <Panel title="Writing style">
        <Row label="Default tone">
          <Segmented label="Default tone" value={s.ai.tone} onChange={(tone) => update.mutate({ ai: { tone } })} options={[{ value: "professional", label: "Professional" }, { value: "friendly", label: "Friendly" }, { value: "concise", label: "Concise" }, { value: "warm", label: "Warm" }]} />
        </Row>
        <form className="space-y-3 py-3" onSubmit={(e) => { e.preventDefault(); update.mutate({ ai: { signature: sig, language: lang.trim() || "auto" } }, { onSuccess: () => toast.success("Writing preferences saved") }); }}>
          <Field label="Reply language" hint="Leave empty to reply in the language of the email.">{(id) => <Input id={id} value={lang} maxLength={40} placeholder="Auto (match the email)" onChange={(e) => setLang(e.target.value)} />}</Field>
          <Field label="Signature" hint="Added by AI drafts. Plain text.">{(id) => <Textarea id={id} value={sig} maxLength={500} rows={3} onChange={(e) => setSig(e.target.value)} />}</Field>
          <div className="flex justify-end"><Button type="submit" variant="primary" loading={update.isPending}>Save</Button></div>
        </form>
      </Panel>
      <p className="text-[12.5px] text-fg-3">Want to keep certain senders or labels away from AI? <Link to="/app/settings/privacy" className="text-accent-ink hover:underline">Manage AI exclusions</Link>.</p>
    </>
  );
}

// ---------------- Privacy ----------------
interface AuditEntry { id: string; feature: string; createdAt: string; itemCount: number; excludedCount: number; items: Array<{ accountId: string | null; threadId: string; subject: string }> }

const FEATURE_LABEL: Record<string, string> = {
  thread_summary: "Email summary",
  explain: "Explain email",
  copilot_thread: "Copilot question about an email",
  draft_new: "Draft new email",
  draft_reply: "Draft reply",
  draft_forward: "Draft forward",
  rewrite_shorter: "Rewrite: shorter",
  rewrite_longer: "Rewrite: longer",
  rewrite_fix: "Rewrite: fix grammar",
  rewrite_tone: "Rewrite: change tone",
  nl_search: "Natural-language search",
  ask_inbox: "Ask your inbox",
  overview: "AI Overview",
  copilot_plan: "Copilot: planned actions",
  copilot_execute: "Copilot: actions you confirmed",
  copilot_undo: "Copilot: undo",
};

function PrivacySection() {
  const { s, update } = useSettingsData();
  const { session, config } = useSession();
  const qc = useQueryClient();
  const audit = useQuery({ queryKey: ["privacy-audit"], queryFn: () => api.get<{ entries: AuditEntry[] }>("/privacy/audit") });
  const [confirmClear, setConfirmClear] = useState(false);
  const [sender, setSender] = useState("");
  const labels = useLabels();
  const clear = useMutation({
    mutationFn: () => api.del<{ deleted: number }>("/privacy/audit"),
    onSuccess: (r) => {
      toast.success(`Cleared ${r.deleted} AI history ${r.deleted === 1 ? "entry" : "entries"}`);
      setConfirmClear(false);
      void qc.invalidateQueries({ queryKey: ["privacy-audit"] });
      void qc.invalidateQueries({ queryKey: ["privacy-data"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const accountEmail = (id: string) => session?.accounts?.find((a) => a.id === id)?.email ?? "";
  const userLabels = (labels.data?.accounts ?? []).flatMap((a) => a.labels.filter((l) => l.type === "user" || ["IMPORTANT", "STARRED", "CATEGORY_PERSONAL", "CATEGORY_UPDATES", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"].includes(l.id)).map((l) => ({ key: `${a.accountId}:${l.id}`, name: l.name.replace(/^CATEGORY_/, "Category: ").replace(/_/g, " "), account: accountEmail(a.accountId) })));
  const multi = (session?.accounts?.length ?? 0) > 1;
  const addSender = () => {
    const v = sender.trim().toLowerCase();
    if (!v) return;
    if (!/^(@?[a-z0-9.-]+\.[a-z]{2,}|[^\s@]+@[a-z0-9.-]+\.[a-z]{2,})$/.test(v)) {
      toast.error("Enter an email address or a domain like @bank.com");
      return;
    }
    if (s.ai.excludedSenders.includes(v)) return setSender("");
    update.mutate({ ai: { excludedSenders: [...s.ai.excludedSenders, v] } }, { onSuccess: () => setSender("") });
  };
  const toggleLabel = (key: string, on: boolean) => update.mutate({ ai: { excludedLabels: on ? [...s.ai.excludedLabels, key] : s.ai.excludedLabels.filter((k) => k !== key) } });

  return (
    <>
      <div className="ai-block flex gap-3 rounded-[var(--radius-card)] p-4 text-[13px] text-fg-2">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent-ink" />
        <p>FLUENT never stores your email bodies. Mail is read live from Gmail. When you use an AI feature, only the emails needed are sent to the AI provider ({aiProviderName(config?.aiProvider)}), which processes them under its API terms. Everything the AI accessed is listed below. Read the <Link to="/privacy" className="text-accent-ink hover:underline">privacy policy</Link>.</p>
      </div>

      <Panel title="Exclude from AI" description="Excluded conversations are never sent to AI. This is enforced on the server before any AI request.">
        <div className="space-y-2 py-3">
          <p className="text-[13.5px] font-medium text-fg">Senders and domains</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addSender(); }}>
            <label htmlFor="exclude-sender" className="sr-only">Sender or domain to exclude</label>
            <Input id="exclude-sender" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="name@example.com or @bank.com" maxLength={254} />
            <Button type="submit" icon={<Plus className="size-3.5" />}>Add</Button>
          </form>
          {s.ai.excludedSenders.length === 0 ? <p className="text-xs text-fg-3">No senders excluded.</p> : (
            <ul className="flex flex-wrap gap-2" aria-label="Excluded senders">
              {s.ai.excludedSenders.map((x) => (
                <li key={x} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface-2 pl-3 pr-1 text-[12.5px] text-fg">
                  {x}
                  <button type="button" aria-label={`Remove ${x}`} className="rounded-full p-1 text-fg-3 hover:bg-surface-3 hover:text-fg" onClick={() => update.mutate({ ai: { excludedSenders: s.ai.excludedSenders.filter((y) => y !== x) } })}><X className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2 border-t border-line py-3">
          <p className="text-[13.5px] font-medium text-fg">Labels</p>
          {labels.isLoading ? <Skeleton className="h-16 w-full" /> : userLabels.length === 0 ? <p className="text-xs text-fg-3">No labels available.</p> : (
            <div className="grid gap-1 sm:grid-cols-2">
              {userLabels.map((l) => {
                const on = s.ai.excludedLabels.includes(l.key);
                return (
                  <label key={l.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-fg hover:bg-surface-2">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={on} onChange={(e) => toggleLabel(l.key, e.target.checked)} />
                    <span className="truncate">{l.name}</span>
                    {multi && <span className="ml-auto truncate text-[11px] text-fg-3">{l.account}</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Email content">
        <Row label="Load remote images" description="Remote images can reveal when you open an email. Blocked by default.">
          <Segmented label="Load remote images" value={s.privacy.loadRemoteImages} onChange={(loadRemoteImages) => update.mutate({ privacy: { loadRemoteImages } })} options={[{ value: "never", label: "Never" }, { value: "ask", label: "Ask" }, { value: "always", label: "Always" }]} />
        </Row>
        <Row label="Keep AI history" description="How long the AI access log below is kept. 'Off' records nothing.">
          <select aria-label="Keep AI history" value={s.privacy.keepAiHistoryDays} onChange={(e) => update.mutate({ privacy: { keepAiHistoryDays: Number(e.target.value) } })} className="h-9 rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-fg">
            {[[0, "Off"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Row>
      </Panel>

      <Panel
        title="AI access log"
        description="Every AI request: when, which feature, and which emails (by subject) it read. Email bodies are never logged."
        actions={<Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} disabled={!audit.data?.entries.length} onClick={() => setConfirmClear(true)}>Clear history</Button>}
      >
        {audit.isLoading ? <Skeleton className="my-3 h-24 w-full" /> : audit.isError ? <p className="py-4 text-[13px] text-danger">{errorMessage(audit.error)}</p> : !audit.data?.entries.length ? (
          <p className="py-6 text-center text-[13px] text-fg-3">No AI activity recorded{s.privacy.keepAiHistoryDays === 0 ? " — history is turned off" : ""}.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="AI access log">
            {audit.data.entries.map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[13.5px] font-medium text-fg">{FEATURE_LABEL[e.feature] ?? e.feature}</span>
                  <time className="text-xs text-fg-3" dateTime={e.createdAt} title={fullDate(e.createdAt)}>{relative(e.createdAt)}</time>
                  <span className="ml-auto text-xs text-fg-3">{e.itemCount === 0 ? "No emails read" : `${e.itemCount} email${e.itemCount === 1 ? "" : "s"} read`}{e.excludedCount > 0 ? ` · ${e.excludedCount} excluded` : ""}</span>
                </div>
                {e.items.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {e.items.slice(0, 6).map((it) => (
                      <li key={it.threadId} className="truncate text-[12.5px] text-fg-2">
                        {it.accountId ? <Link className="hover:text-fg hover:underline" to={`/app/all/${it.accountId}/${it.threadId}`}>{it.subject || "(no subject)"}</Link> : it.subject}
                        <span className="ml-2 font-mono text-[10.5px] text-fg-3">{it.threadId}</span>
                      </li>
                    ))}
                    {e.items.length > 6 && <li className="text-xs text-fg-3">+{e.items.length - 6} more</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} title="Clear AI history?" description="This permanently deletes the AI access log. It doesn't affect your email." confirmLabel="Clear history" danger loading={clear.isPending} onConfirm={() => clear.mutate()} />
    </>
  );
}

// ---------------- Security ----------------
function SecuritySection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get<{ sessions: Array<{ id: string; current: boolean; userAgent: string | null; createdAt: string; lastSeenAt: string }> }>("/security/sessions") });
  const events = useQuery({ queryKey: ["security-events"], queryFn: () => api.get<{ events: Array<{ id: string; type: string; detail: string | null; createdAt: string }> }>("/security/events") });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["sessions"] }); void qc.invalidateQueries({ queryKey: ["security-events"] }); };
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/security/sessions/${id}`), onSuccess: () => { toast.success("Session signed out"); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const revokeOthers = useMutation({ mutationFn: () => api.post<{ revoked: number }>("/security/sessions/revoke-others"), onSuccess: (r) => { toast.success(`Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}`); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const logout = useMutation({ mutationFn: () => api.post("/auth/logout"), onSuccess: () => { qc.clear(); navigate("/", { replace: true }); } });
  const others = sessions.data?.sessions.filter((s) => !s.current).length ?? 0;
  return (
    <>
      <Panel title="Active sessions" description="Browsers signed in to FLUENT. Sessions expire 30 days after sign-in." actions={<Button size="sm" variant="ghost" disabled={others === 0} loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>Sign out others</Button>}>
        {sessions.isLoading ? <Skeleton className="my-3 h-16 w-full" /> : (
          <ul className="divide-y divide-line">
            {sessions.data?.sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] text-fg">{describeUa(s.userAgent)} {s.current && <Badge className="ml-1">This device</Badge>}</p>
                  <p className="text-xs text-fg-3">Signed in {relative(s.createdAt)} · active {relative(s.lastSeenAt)}</p>
                </div>
                {s.current ? <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={() => logout.mutate()}>Sign out</Button> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Revoke</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Security activity" description="Recent sign-ins and sensitive changes. No email content is recorded.">
        {events.isLoading ? <Skeleton className="my-3 h-16 w-full" /> : !events.data?.events.length ? <p className="py-4 text-[13px] text-fg-3">No activity yet.</p> : (
          <ul className="divide-y divide-line">
            {events.data.events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <span className="text-fg">{e.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}{e.detail && e.type.startsWith("account") ? ` · ${e.detail}` : ""}</span>
                <time className="shrink-0 text-xs text-fg-3" title={fullDate(e.createdAt)}>{relative(e.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function describeUa(ua: string | null): string {
  if (!ua) return "Unknown browser";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

// ---------------- Your data ----------------
function DataSection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const data = useQuery({ queryKey: ["privacy-data"], queryFn: () => api.get<{ stored: Array<{ key: string; label: string; detail: string; count: number }>; notStored: string[] }>("/privacy/data") });
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => api.del<{ revokedAtGoogle: boolean }>("/me", { confirm: "DELETE" }),
    onSuccess: () => {
      qc.clear();
      navigate("/?deleted=1", { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Panel title="What FLUENT stores" description="Everything FLUENT keeps about you in its database.">
        {data.isLoading ? <Skeleton className="my-3 h-32 w-full" /> : data.isError ? <p className="py-4 text-[13px] text-danger">{errorMessage(data.error)}</p> : (
          <>
            <ul className="divide-y divide-line" aria-label="Stored data">
              {data.data!.stored.map((s) => (
                <li key={s.key} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-fg">{s.label}</p>
                    <p className="text-xs text-fg-3">{s.detail}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs tabular-nums text-fg-2">{s.count}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line py-3">
              <p className="text-[13px] font-medium text-fg">Never stored</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-fg-3">{data.data!.notStored.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          </>
        )}
      </Panel>
      <Panel title="Export your data" description="Download everything above as JSON. OAuth tokens are never included.">
        <div className="py-3">
          <Button icon={<Download className="size-4" />} onClick={() => { window.location.href = "/api/privacy/export"; }}>Download export</Button>
        </div>
      </Panel>
      <section className="rounded-[var(--radius-card)] border border-danger/40 bg-danger/5 px-5 py-4">
        <h2 className="text-[14.5px] font-semibold text-fg">Delete my FLUENT data</h2>
        <p className="mt-1 text-[12.5px] text-fg-3">Revokes FLUENT's access to every connected Google account and permanently deletes your profile, settings, sessions and logs. Your Gmail messages are not touched.</p>
        <Button className="mt-3" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setOpen(true)}>Delete my data</Button>
      </section>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }} title="Delete all your FLUENT data?" description="This can't be undone. Type DELETE to confirm.">
        <form onSubmit={(e) => { e.preventDefault(); if (typed === "DELETE") del.mutate(); }} className="space-y-4">
          <label htmlFor="confirm-delete" className="sr-only">Type DELETE to confirm</label>
          <Input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoComplete="off" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={typed !== "DELETE"} loading={del.isPending}>Delete everything</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
