import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Bell, Check, ChevronRight, ExternalLink, Eye, FileStack, Info, Keyboard, Menu, Palette, Plus, ShieldCheck, SlidersHorizontal, Sparkles, Tags, Trash2, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { aiProviderName } from "@/lib/ai";
import { SETTINGS_SAVED_EVENT, useUpdateSettings } from "@/lib/settings";
import { FOCUS_LABELS } from "@/lib/focus";
import { FOCUS_CHOICES, type FocusChoice } from "@shared/focus";
import { GROUPS as SHORTCUT_GROUPS } from "../Shortcuts";
import { useLabels } from "@/lib/mail";
import { cn } from "@/lib/cn";
import { ACCENTS, type Accent, type DEFAULT_VIEWS } from "@shared/settings";
import { fullDate, relative } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Switch, Textarea } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Kbd, Skeleton } from "@/components/ui/misc";
import { SidebarContext } from "../AppLayout";
import { LabelsFiltersSection } from "./LabelsFilters";
import { TemplatesSection } from "./Templates";
import { SignaturesSection } from "./Signatures";

const SECTIONS = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "ai", label: "Copilot & AI", icon: Sparkles },
  { id: "privacy", label: "Privacy", icon: Eye },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
  { id: "templates", label: "Templates & signatures", icon: FileStack },
  { id: "labels", label: "Labels & filters", icon: Tags },
  { id: "about", label: "About", icon: Info },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** Gmail-only settings (labels & filters, signatures and send-as name) are hidden when no connected account supports them. */
function useCaps() {
  const accounts = useSession().session?.accounts ?? [];
  const has = (k: "labels" | "filters" | "sendAs") => accounts.some((a) => a.capabilities?.[k] ?? true);
  return { labels: has("labels") || has("filters"), sendAs: has("sendAs") };
}
function useSections() {
  const caps = useCaps();
  return SECTIONS.filter((s) => s.id !== "labels" || caps.labels).map((s) => (s.id === "templates" && !caps.sendAs ? { ...s, label: "Templates" } : s));
}
/** Old section links that moved: signatures live with templates; profile, accounts, security and data on the Account page. */
const MOVED: Record<string, string> = { signatures: "/app/settings/templates", profile: "/app/account", accounts: "/app/account#accounts", security: "/app/account#sessions", data: "/app/account#data" };

export function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const sections = useSections();
  if (!section) return <SettingsIndex />;
  if (MOVED[section]) return <Navigate to={MOVED[section] + (MOVED[section].includes("#") ? "" : location.search)} replace />;
  const meta = sections.find((s) => s.id === section);
  if (!meta) return <Navigate to="/app/settings/general" replace />;
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Settings sections" className="hidden w-[248px] shrink-0 flex-col gap-0.5 overflow-y-auto px-3 py-4 scroll-thin md:flex">
        <h2 className="px-3 pb-2 text-[20px] font-semibold text-fg">Settings</h2>
        <AccountLink compact />
        {sections.map((s) => (
          <NavLink key={s.id} to={`/app/settings/${s.id}`} className={({ isActive }) => cn("flex h-9 items-center gap-3 rounded-full px-3 text-[13.5px] transition-colors", isActive ? "bg-accent-soft font-medium text-fg" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}>
            <s.icon className="size-4 text-fg-3" aria-hidden />{s.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title={meta.label} onBack={() => navigate("/app/settings")} />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl space-y-5 px-4 pb-10 pt-2 md:px-8 md:pt-4">
            <Section id={meta.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Top bar of a settings page: back on mobile, navigation drawer on tablet, and a live "Saved" confirmation. */
export function PageHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-3 md:px-8">
      {onBack && <IconButton label="Back to settings" className="md:hidden" onClick={onBack}><ArrowLeft className="size-5" /></IconButton>}
      <IconButton label="Open navigation" className={onBack ? "max-md:hidden lg:hidden" : "lg:hidden"} onClick={() => SidebarContext.open()}><Menu className="size-5" /></IconButton>
      <h1 className="min-w-0 flex-1 truncate text-[18px] font-semibold text-fg">{title}</h1>
      <SavedIndicator />
    </header>
  );
}

/** Announces every successful settings save ("Saved") for a couple of seconds. */
export function SavedIndicator() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let t = 0;
    const on = () => { setShown(Date.now()); window.clearTimeout(t); t = window.setTimeout(() => setShown(0), 2200); };
    window.addEventListener(SETTINGS_SAVED_EVENT, on);
    return () => { window.removeEventListener(SETTINGS_SAVED_EVENT, on); window.clearTimeout(t); };
  }, []);
  return (
    <span role="status" aria-live="polite" className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-medium text-success transition-opacity", shown ? "opacity-100" : "opacity-0")}>
      {shown ? <><Check className="size-3.5" aria-hidden />Saved</> : null}
    </span>
  );
}

function AccountLink({ compact = false }: { compact?: boolean }) {
  const { session } = useSession();
  const user = session!.user!;
  const name = session?.settings?.profile.displayName || user.name;
  return (
    <Link to="/app/account" className={cn("flex items-center gap-3 rounded-2xl hover:bg-surface-2", compact ? "mb-2 px-3 py-2" : "bg-surface px-4 py-3.5")}>
      <Avatar name={name} email={user.email} src={user.picture} size={compact ? 32 : 44} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium text-fg", compact ? "text-[13px]" : "text-[15px]")}>{name}</span>
        <span className="block truncate text-[12px] text-fg-3">Account, connected Gmail, sessions</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-fg-3" aria-hidden />
    </Link>
  );
}

function SettingsIndex() {
  const sections = useSections();
  const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  if (isDesktop) return <Navigate to="/app/settings/general" replace />;
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        <IconButton label="Open navigation" onClick={() => SidebarContext.open()}><Menu className="size-5" /></IconButton>
        <h1 className="text-[20px] font-semibold text-fg">Settings</h1>
      </header>
      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-8 pt-1">
        <AccountLink />
        <nav aria-label="Settings sections" className="overflow-hidden rounded-2xl bg-surface">
          {sections.map((s, i) => (
            <Link key={s.id} to={`/app/settings/${s.id}`} className="flex items-center gap-3 px-4 hover:bg-surface-2">
              <s.icon className="size-[18px] shrink-0 text-fg-2" aria-hidden />
              <span className={cn("flex min-h-[50px] flex-1 items-center justify-between gap-2 text-[15px] text-fg", i > 0 && "border-t border-line")}>
                {s.label}<ChevronRight className="size-4 text-fg-3" aria-hidden />
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function TemplatesAndSignatures() {
  const { sendAs } = useCaps();
  return <><TemplatesSection />{sendAs && <SignaturesSection />}</>;
}

function Section({ id }: { id: SectionId }) {
  switch (id) {
    case "general": return <GeneralSection />;
    case "appearance": return <AppearanceSection />;
    case "notifications": return <NotificationsSection />;
    case "ai": return <AiSection />;
    case "privacy": return <PrivacySection />;
    case "shortcuts": return <ShortcutsSection />;
    case "templates": return <TemplatesAndSignatures />;
    case "labels": return <LabelsFiltersSection />;
    case "about": return <AboutSection />;
  }
}

export function Panel({ id, title, description, children, actions }: { id?: string; title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-4 rounded-2xl bg-surface">
      <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-4">
        <div>
          <h2 className="text-[14.5px] font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-fg-3">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="px-5 pb-3">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
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

const ACCENT_SWATCH: Record<Accent, { label: string; color: string }> = {
  purple: { label: "Purple", color: "#7c3aed" },
  blue: { label: "Blue", color: "#2563eb" },
  teal: { label: "Teal", color: "#0f766e" },
  rose: { label: "Rose", color: "#e11d48" },
  orange: { label: "Orange", color: "#c2410c" },
};

function AccentPicker({ value, onChange }: { value: Accent; onChange: (v: Accent) => void }) {
  return (
    <div role="radiogroup" aria-label="Accent colour" className="flex gap-2">
      {ACCENTS.map((a) => (
        <button key={a} type="button" role="radio" aria-checked={value === a} aria-label={ACCENT_SWATCH[a].label} title={ACCENT_SWATCH[a].label} onClick={() => onChange(a)}
          className={cn("flex size-8 items-center justify-center rounded-full border-2", value === a ? "border-fg" : "border-transparent hover:border-line-strong")}>
          <span className="size-5 rounded-full" style={{ background: ACCENT_SWATCH[a].color }} aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
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

export function useSettingsData() {
  const { session } = useSession();
  return { s: session!.settings!, update: useUpdateSettings() };
}

// ---------------- General ----------------
const LANGUAGES: Array<[string, string]> = [["auto", "Automatic (browser)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"], ["nb-NO", "Norsk bokmål"], ["nn-NO", "Norsk nynorsk"], ["sv-SE", "Svenska"], ["da-DK", "Dansk"], ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["es-ES", "Español"]];

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Europe/Oslo", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
  }
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 max-w-full rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] sm:max-w-[260px]">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function GeneralSection() {
  const { s, update } = useSettingsData();
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = timeZones();
  const sample = fullDate(new Date().toISOString());
  return (
    <>
      <Panel title="Language & region" description="FLUENT's menus are in English. Language sets date and time formats and the language of your daily brief.">
        <Row label="Language" description={`Example: ${sample}`}>
          <Select label="Language" value={s.general.language} onChange={(language) => update.mutate({ general: { language } })} options={LANGUAGES} />
        </Row>
        <Row label="Time zone" description="Used for times in the list, focus mode and when your daily brief starts.">
          <Select label="Time zone" value={s.general.timeZone} onChange={(timeZone) => update.mutate({ general: { timeZone } })} options={[["auto", `Automatic (${deviceTz})`], ...zones.map((z): [string, string] => [z, z.replace(/_/g, " ")])]} />
        </Row>
      </Panel>
      <Panel title="Mail">
        <Row label="Default view" description="Where FLUENT opens.">
          <Select label="Default view" value={s.general.defaultView} onChange={(v) => update.mutate({ general: { defaultView: v as (typeof DEFAULT_VIEWS)[number] } })} options={[["inbox", "Inbox"], ["overview", "AI Overview"], ["starred", "Starred"], ["important", "Important"]]} />
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
    </>
  );
}

// ---------------- Appearance ----------------
function AppearanceSection() {
  const { s, update } = useSettingsData();
  return (
    <Panel title="Theme">
      <Row label="Theme" description="Dark is FLUENT's default.">
        <Segmented label="Theme" value={s.appearance.theme} onChange={(theme) => update.mutate({ appearance: { theme } })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
      </Row>
      <Row label="Accent colour" description="Used for buttons, links and highlights, in both themes.">
        <AccentPicker value={s.appearance.accent} onChange={(accent) => update.mutate({ appearance: { accent } })} />
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
    <>
    <Panel title="Alerts" description="FLUENT checks Gmail for changes about every 45 seconds while it's open.">
      <Switch label="In-app alerts" description="Show a toast when new mail arrives." checked={s.notifications.inApp} onChange={(inApp) => update.mutate({ notifications: { inApp } })} />
      <Switch label="Desktop notifications" description={!supported ? "Not supported in this browser." : perm === "denied" ? "Blocked in your browser settings." : "Notify you with a system notification."} checked={s.notifications.desktop} disabled={!supported} onChange={(v) => void enableDesktop(v)} />
    </Panel>
    <Panel title="Focus mode" description="Shows only important mail for a while. Start it from the sidebar or ⌘K.">
      <Row label="Default length" description="Offered first when you start focus mode.">
        <Select label="Default focus length" value={s.focus.defaultChoice} onChange={(v) => update.mutate({ focus: { defaultChoice: v as FocusChoice } })} options={FOCUS_CHOICES.map((c): [string, string] => [c, FOCUS_LABELS[c]])} />
      </Row>
      <Switch label="Silence new-mail alerts while focusing" description="No toasts or desktop notifications for new mail until focus ends." checked={s.focus.muteToasts} onChange={(muteToasts) => update.mutate({ focus: { muteToasts } })} />
    </Panel>
    </>
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
      <Panel title="Copilot & AI features" description={`Provider: ${aiProviderName(config?.aiProvider)}${config?.aiModel ? ` (${config.aiModel})` : ""}. AI only drafts and explains — it can never send, delete or forward email on its own.`}>
        <Switch label="Enable AI" description="Turns off every AI feature and stops all AI requests when disabled." checked={s.ai.enabled} onChange={(enabled) => update.mutate({ ai: { enabled } })} />
        <Switch label="Summarize emails automatically" description="Generate a summary when you open a conversation. When off, click Summarize instead." checked={s.ai.autoSummarize} disabled={!s.ai.enabled} onChange={(autoSummarize) => update.mutate({ ai: { autoSummarize } })} />
      </Panel>
      <Panel title="Daily brief" description="A one-line summary at the top of your inbox: what's important, what awaits your reply, and what's safe to archive.">
        <Switch label="Show the daily brief" description="When off, no brief is generated." checked={s.ai.dailyBrief} onChange={(dailyBrief) => update.mutate({ ai: { dailyBrief } })} />
        <Row label="Show from" description="The brief appears from this time each day, in your time zone.">
          <Select label="Show the brief from" value={String(s.ai.briefHour)} onChange={(v) => update.mutate({ ai: { briefHour: Number(v) } })} options={Array.from({ length: 24 }, (_, h): [string, string] => [String(h), h === 0 ? "Midnight (any time)" : `${String(h).padStart(2, "0")}:00`])} />
        </Row>
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
  security_check: "Phishing check",
  daily_brief: "Daily brief",
  reply_suggestions: "Reply suggestions",
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


// ---------------- Shortcuts ----------------
function ShortcutsSection() {
  const { s, update } = useSettingsData();
  return (
    <>
      <Panel title="Keyboard shortcuts">
        <Switch label="Single-key shortcuts" description="j / k, e, r, c and the others below. Shortcuts with ⌘ or Ctrl always work." checked={s.shortcuts.enabled} onChange={(enabled) => update.mutate({ shortcuts: { enabled } })} />
      </Panel>
      {SHORTCUT_GROUPS.map(([group, items]) => (
        <Panel key={group} title={group}>
          <dl className={cn("divide-y divide-line", !s.shortcuts.enabled && group !== "Compose" && group !== "Copilot" && "opacity-60")}>
            {items.map(([k, d]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
                <dt className="text-fg-2">{d}</dt>
                <dd><Kbd>{k}</Kbd></dd>
              </div>
            ))}
          </dl>
        </Panel>
      ))}
    </>
  );
}

// ---------------- About ----------------
function AboutSection() {
  const { config } = useSession();
  return (
    <>
      <Panel title="FLUENT" description="An AI-first Gmail client. Your mail stays in Gmail; FLUENT reads it live.">
        <dl className="divide-y divide-line text-[13px]">
          <div className="flex justify-between gap-4 py-2.5"><dt className="text-fg-3">Version</dt><dd className="font-mono text-fg">{__APP_VERSION__}{__APP_COMMIT__ ? ` (${__APP_COMMIT__})` : ""}</dd></div>
          <div className="flex justify-between gap-4 py-2.5"><dt className="text-fg-3">AI provider</dt><dd className="text-fg">{config?.ai ? `${aiProviderName(config.aiProvider)}${config.aiModel ? ` · ${config.aiModel}` : ""}` : "Not configured"}</dd></div>
        </dl>
      </Panel>
      <Panel title="Legal">
        <ul className="divide-y divide-line text-[13.5px]">
          {([["/privacy", "Privacy policy"], ["/terms", "Terms of service"], ["https://github.com/VargiBeast/Fluent", "Source code on GitHub"]] as Array<[string, string]>).map(([href, label]) => (
            <li key={href}>
              {href.startsWith("http")
                ? <a href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between py-3 text-fg hover:text-accent-ink">{label}<ExternalLink className="size-3.5 text-fg-3" aria-hidden /></a>
                : <Link to={href} className="flex items-center justify-between py-3 text-fg hover:text-accent-ink">{label}<ChevronRight className="size-4 text-fg-3" aria-hidden /></Link>}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
