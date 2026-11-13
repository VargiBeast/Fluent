import { FocusMenu } from "./FocusMode";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { BarChart3, ChevronDown, MailMinus, Keyboard, LogOut, PenSquare, Plus, Search, Settings, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Logo } from "@/components/ui/misc";
import { Button, IconButton } from "@/components/ui/Button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/Menu";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { useLabels } from "@/lib/mail";
import { api, errorMessage } from "@/lib/api";
import { FOLDER_META, OverviewIcon, SIDEBAR_FOLDERS } from "./nav";
import { useComposer } from "./composer/context";
import { useShortcutsDialog } from "./Shortcuts";
import { useCopilot } from "./copilot/context";

const ACCOUNT_COLORS = ["#a78bfa", "#38bdf8", "#f472b6", "#34d399", "#fbbf24"];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { session } = useSession();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const account = params.get("account") ?? undefined;
  const labels = useLabels(account);
  const composer = useComposer();
  const shortcuts = useShortcutsDialog();
  const copilot = useCopilot();
  const [labelOpen, setLabelOpen] = useState(false);
  const accounts = session?.accounts ?? [];
  const user = session?.user;

  const counts: Record<string, number> = {};
  for (const a of labels.data?.accounts ?? []) for (const [k, v] of Object.entries(a.counts)) counts[k] = (counts[k] ?? 0) + v;
  const withAccount = (path: string, extra?: Record<string, string>) => {
    const p = new URLSearchParams();
    if (account) p.set("account", account);
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  };
  const currentFolder = location.pathname.split("/")[2] ?? "inbox";
  const accountIndex = (id: string) => accounts.findIndex((a) => a.id === id);

  const logout = async () => {
    try {
      await api.post("/auth/logout");
      qc.clear();
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const item = (active: boolean) =>
    cn(
      "group flex h-9 items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-[13.5px] transition-colors duration-[var(--duration-fast)]",
      active
        ? "bg-accent-soft text-fg font-medium ring-1 ring-inset ring-[var(--ai-border)]"
        : "text-fg-2 hover:bg-surface-2 hover:text-fg",
    );

  return (
    <nav aria-label="Mailboxes" className="flex h-full flex-col gap-0.5 overflow-y-auto px-3 pb-4 pt-4 scroll-thin">
      <div className="flex items-center justify-between px-1 pb-3">
        <Logo />
      </div>

      {user && (
        <Menu>
          <MenuTrigger asChild>
            <button className="mb-2 flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2" aria-label="Account menu">
              <Avatar name={user.name} email={user.email} src={user.picture} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-fg">{session?.settings?.profile.displayName || user.name}</span>
                <span className="block truncate text-xs text-fg-3">{user.email}</span>
              </span>
              <ChevronDown className="size-4 text-fg-3" aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuItem icon={<UserRound />} onSelect={() => { navigate("/app/account"); onNavigate?.(); }}>Account</MenuItem>
            <MenuItem icon={<Settings />} onSelect={() => { navigate("/app/settings"); onNavigate?.(); }}>Settings</MenuItem>
            <MenuItem icon={<ShieldCheck />} onSelect={() => { navigate("/app/settings/privacy"); onNavigate?.(); }}>Privacy dashboard</MenuItem>
            <MenuItem icon={<Keyboard />} onSelect={() => shortcuts.open()}>Keyboard shortcuts</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} onSelect={logout}>Sign out</MenuItem>
          </MenuContent>
        </Menu>
      )}

      <Button variant="primary" className="mb-1 w-full" icon={<PenSquare className="size-4" />} onClick={() => { composer.open({ mode: "new" }); onNavigate?.(); }}>
        Compose
      </Button>
      <button
        type="button"
        onClick={() => { navigate(withAccount(`/app/${["overview", "settings", "account", "stats", "newsletters"].includes(currentFolder) ? "inbox" : currentFolder}`, { focus: "search" })); onNavigate?.(); }}
        className="mb-2 flex h-9 w-full items-center gap-3 rounded-[10px] px-2.5 text-[13.5px] text-fg-3 hover:bg-surface-2 hover:text-fg"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <kbd className="text-[11px] text-fg-3">/</kbd>
      </button>
      <button
        type="button"
        onClick={() => { onNavigate?.(); copilot.open(); }}
        className="mb-2 -mt-1 flex h-9 w-full items-center gap-3 rounded-[10px] px-2.5 text-[13.5px] text-fg-2 hover:bg-surface-2 hover:text-fg"
      >
        <Sparkles className="size-4 text-accent-ink" aria-hidden />
        <span className="flex-1 text-left">Copilot</span>
        <kbd className="text-[11px] text-fg-3">⌘J</kbd>
      </button>

      <NavLink to={withAccount("/app/overview")} onClick={onNavigate} className={({ isActive }) => item(isActive)}>
        <OverviewIcon className="size-4 text-accent-ink" aria-hidden />
        <span className="flex-1">AI Overview</span>
      </NavLink>
      <NavLink to={withAccount("/app/stats")} onClick={onNavigate} className={({ isActive }) => item(isActive)}>
        <BarChart3 className="size-4" aria-hidden />
        <span className="flex-1">Inbox stats</span>
      </NavLink>
      <FocusMenu className={item(false)} />
      <NavLink to={withAccount("/app/newsletters")} onClick={onNavigate} className={({ isActive }) => item(isActive)}>
        <MailMinus className="size-4" aria-hidden />
        <span className="flex-1">Unsubscribe</span>
      </NavLink>

      {SIDEBAR_FOLDERS.map((f) => {
        const meta = FOLDER_META[f];
        const count = meta.countKey ? counts[meta.countKey] : undefined;
        const Icon = meta.icon;
        return (
          <NavLink key={f} to={withAccount(`/app/${f}`)} onClick={onNavigate} className={() => item(currentFolder === f)}>
            <Icon className="size-4" aria-hidden />
            <span className="flex-1">{meta.label}</span>
            {count !== undefined && count > 0 && (
              <Badge tone={f === "inbox" ? "danger" : "muted"} className={f === "inbox" ? "bg-[#ef4444] text-white" : ""}>
                <span className="sr-only">{f === "drafts" ? "drafts:" : "unread:"}</span>
                {count > 999 ? "999+" : count}
              </Badge>
            )}
          </NavLink>
        );
      })}

      <div className="mt-4 px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-fg-3">Accounts</div>
      <NavLink
        to={location.pathname.startsWith("/app/settings") ? "/app/inbox" : location.pathname.split("/").slice(0, 3).join("/")}
        onClick={onNavigate}
        className={() => item(!account)}
      >
        <span className="size-2 rounded-full bg-gradient-to-br from-accent-300 to-accent-700" aria-hidden />
        <span className="flex-1">All inboxes</span>
      </NavLink>
      {accounts.map((a, i) => {
        const acct = labels.data?.accounts.find((x) => x.accountId === a.id);
        const unread = acct?.counts.INBOX ?? 0;
        const p = new URLSearchParams({ account: a.id });
        return (
          <NavLink
            key={a.id}
            to={`/app/${["overview", "settings", "onboarding"].includes(currentFolder) ? "inbox" : currentFolder}?${p}`}
            onClick={onNavigate}
            className={() => item(account === a.id)}
            title={a.email}
          >
            <span className="size-2 rounded-full" style={{ background: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{a.email}</span>
            {a.status !== "active" ? (
              <span className="text-[11px] text-warning">Reconnect</span>
            ) : unread > 0 ? (
              <Badge tone="muted">{unread}</Badge>
            ) : null}
          </NavLink>
        );
      })}
      <NavLink to="/app/account#accounts" onClick={onNavigate} className={() => item(false)}>
        <Plus className="size-4" aria-hidden />
        <span className="flex-1">Add account</span>
      </NavLink>

      <div className="mt-4 flex items-center justify-between px-2.5 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-fg-3">Labels</span>
        <IconButton label="Create label" size="sm" onClick={() => setLabelOpen(true)}>
          <Plus className="size-3.5" />
        </IconButton>
      </div>
      {labels.isLoading && <div className="px-2.5 py-1 text-xs text-fg-3">Loading labels…</div>}
      {(labels.data?.accounts ?? []).flatMap((acc) =>
        acc.labels.map((l) => {
          const p = new URLSearchParams({ label: l.id, account: acc.accountId, name: l.name });
          const active = currentFolder === "label" && params.get("label") === l.id && params.get("account") === acc.accountId;
          return (
            <NavLink key={`${acc.accountId}:${l.id}`} to={`/app/label?${p}`} onClick={onNavigate} className={() => item(active)}>
              <span
                className="size-2 rounded-sm"
                style={{ background: l.color?.backgroundColor ?? ACCOUNT_COLORS[accountIndex(acc.accountId) % ACCOUNT_COLORS.length] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              {accounts.length > 1 && !account && <span className="max-w-[70px] truncate text-[10.5px] text-fg-3">{accounts[accountIndex(acc.accountId)]?.email.split("@")[0]}</span>}
            </NavLink>
          );
        }),
      )}

      <div className="mt-auto pt-4">
        <NavLink to="/app/settings" onClick={onNavigate} className={() => item(currentFolder === "settings")}>
          <Settings className="size-4" aria-hidden />
          <span className="flex-1">Settings</span>
        </NavLink>
        <button type="button" onClick={() => shortcuts.open()} className={cn(item(false), "w-full")}>
          <Keyboard className="size-4" aria-hidden />
          <span className="flex-1 text-left">Shortcuts</span>
          <kbd className="text-[11px] text-fg-3">?</kbd>
        </button>
      </div>

      <CreateLabelDialog open={labelOpen} onOpenChange={setLabelOpen} defaultAccount={account ?? accounts[0]?.id} />
    </nav>
  );
}

export function CreateLabelDialog({ open, onOpenChange, defaultAccount }: { open: boolean; onOpenChange: (v: boolean) => void; defaultAccount?: string }) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [acc, setAcc] = useState(defaultAccount ?? "");
  const [busy, setBusy] = useState(false);
  const accounts = session?.accounts ?? [];
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post("/mail/labels", { accountId: acc || defaultAccount || accounts[0]?.id, name: name.trim() });
      toast.success(`Label “${name.trim()}” created in Gmail`);
      setName("");
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ["labels"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Create label" description="Labels are created in Gmail and stay in sync.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Label name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus placeholder="e.g. Clients" />}</Field>
        {accounts.length > 1 && (
          <Field label="Account">
            {(id) => (
              <select id={id} value={acc || defaultAccount} onChange={(e) => setAcc(e.target.value)} className="h-9 w-full rounded-[10px] border border-line bg-surface-2 px-2 text-[13.5px] text-fg">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
              </select>
            )}
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!name.trim()}>Create</Button>
        </div>
      </form>
    </Dialog>
  );
}
