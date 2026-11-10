import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Download, LogOut, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useSession, type Account } from "@/lib/session";
import { cn } from "@/lib/cn";
import { DELETE_ACCOUNT_PHRASE } from "@shared/settings";
import { fullDate, relative } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Badge, Skeleton } from "@/components/ui/misc";
import { PageHeader, Panel, useSettingsData } from "./Settings";

/** Plain-language descriptions of the Google permissions an account granted. */
const SCOPE_TEXT: Array<[RegExp, string]> = [
  [/gmail\.modify$/, "Read, label, archive and move your mail to Trash (never delete it permanently)"],
  [/gmail\.settings\.basic$/, "Read and update your Gmail signature and send-as name"],
  [/gmail\.send$/, "Send email you have confirmed"],
  [/gmail\.readonly$/, "Read your mail"],
  [/^(openid|email|profile)$|userinfo\.(email|profile)$/, "See your name, email address and profile photo"],
];
export function scopeText(scopes: string[]): string[] {
  const out = new Set<string>();
  for (const sc of scopes) {
    const hit = SCOPE_TEXT.find(([re]) => re.test(sc));
    out.add(hit ? hit[1] : sc);
  }
  return out.size ? [...out] : ["No permissions recorded"];
}

/** Account: who you are, which mailboxes are connected and what they allow, where you're signed in, and your data. */
export function AccountPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  useEffect(() => {
    void refresh(); // fresh connection status and last-sync times
    const id = window.location.hash.slice(1);
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit; refresh's identity changes every render
  }, []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Account" onBack={() => navigate("/app/settings")} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 px-4 pb-12 pt-2 md:px-8 md:pt-4">
          <ProfileSection />
          <AccountsSection />
          <SecuritySection />
          <DataSection />
        </div>
      </div>
    </div>
  );
}

// ---------------- Profile ----------------
function ProfileSection() {
  const { session } = useSession();
  const { s, update } = useSettingsData();
  const [name, setName] = useState(s.profile.displayName);
  const user = session!.user!;
  return (
    <Panel title="Profile" description="From your Google account. The display name is how you appear in FLUENT; leave it empty to use your Google name.">
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
        id="accounts"
        title="Connected accounts"
        description="Mail from every connected account shows in one unified inbox."
      >
        {accounts.length === 0 ? (
          <p className="py-4 text-[13px] text-fg-3">No accounts connected.</p>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <li key={a.id} className="py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={a.name} email={a.email} src={a.picture} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-fg">{a.email}</p>
                    <p className="text-[12px] text-fg-3">
                      Gmail · connected {relative(a.createdAt)} · {a.lastSyncedAt ? <>last synced <time dateTime={a.lastSyncedAt} title={fullDate(a.lastSyncedAt)}>{relative(a.lastSyncedAt)}</time></> : "not synced yet"}
                    </p>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 text-[12.5px]", a.status === "active" ? "text-fg-2" : "text-danger")}>
                    <span className={cn("size-2 rounded-full", a.status === "active" ? "bg-success" : "bg-danger")} aria-hidden />
                    {a.status === "active" ? "Connected" : a.status === "needs_reauth" ? "Needs sign-in" : "Missing Gmail permission"}
                  </span>
                </div>
                <div className="mt-2 pl-[52px]">
                  <p className="text-[12px] font-medium text-fg-2">FLUENT can:</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12px] text-fg-3" aria-label={`Permissions for ${a.email}`}>
                    {scopeText(a.scopes).map((t) => <li key={t}>{t}</li>)}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {a.status !== "active" && <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => { window.location.href = `/api/auth/google/start?mode=link&account=${a.id}`; }}>Reconnect</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setRemove(a)}>Disconnect</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => { window.location.href = "/api/auth/google/start?mode=link"; }} className="flex w-full items-center gap-3 border-t border-line py-3 text-left text-[14px] text-fg hover:text-accent-ink" data-add-account="">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface-2"><Plus className="size-4" aria-hidden /></span>
          <span className="flex-1">Add account<span className="block text-[12px] text-fg-3">Connect another Gmail account</span></span>
          <ChevronRight className="size-4 text-fg-3" aria-hidden />
        </button>
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
  const everywhere = useMutation({ mutationFn: () => api.post<{ revoked: number }>("/security/sessions/revoke-all"), onSuccess: () => { qc.clear(); navigate("/", { replace: true }); }, onError: (e) => toast.error(errorMessage(e)) });
  const [confirmAll, setConfirmAll] = useState(false);
  const others = sessions.data?.sessions.filter((s) => !s.current).length ?? 0;
  return (
    <>
      <Panel id="sessions" title="Sessions" description="Browsers signed in to FLUENT. Sessions expire 30 days after sign-in.">
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
        <div className="flex flex-wrap gap-2 border-t border-line py-3">
          <Button size="sm" disabled={others === 0} loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>Sign out other sessions</Button>
          <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={() => setConfirmAll(true)}>Sign out everywhere</Button>
        </div>
      </Panel>
      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} title="Sign out everywhere?" description="Every browser, this one included, is signed out of FLUENT. Your Gmail connection stays." confirmLabel="Sign out everywhere" loading={everywhere.isPending} onConfirm={() => everywhere.mutate()} />
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
    mutationFn: () => api.del<{ revokedAtGoogle: boolean }>("/me", { confirm: DELETE_ACCOUNT_PHRASE }),
    onSuccess: () => {
      qc.clear();
      navigate("/?deleted=1", { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Panel id="data" title="What FLUENT stores" description="Everything FLUENT keeps about you in its database.">
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
      <section aria-labelledby="danger-zone" className="px-1 pt-4">
        <h2 id="danger-zone" className="text-[13px] font-medium text-fg-2">Delete account</h2>
        <p className="mt-1 text-[12.5px] text-fg-3">Permanently deletes your FLUENT profile, settings, sessions, templates, notes and logs, and revokes FLUENT's access at Google. Your Gmail messages are not touched.</p>
        <Button className="mt-3" size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setOpen(true)}>Delete my FLUENT account…</Button>
      </section>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }} title="Delete your FLUENT account?" description={`This can't be undone. Type “${DELETE_ACCOUNT_PHRASE}” to confirm.`}>
        <form onSubmit={(e) => { e.preventDefault(); if (typed === DELETE_ACCOUNT_PHRASE) del.mutate(); }} className="space-y-4">
          <label htmlFor="confirm-delete" className="sr-only">Type {DELETE_ACCOUNT_PHRASE} to confirm</label>
          <Input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={DELETE_ACCOUNT_PHRASE} autoComplete="off" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={typed !== DELETE_ACCOUNT_PHRASE} loading={del.isPending}>Delete account</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
