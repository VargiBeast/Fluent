import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, ChevronUp, Inbox, Loader2, Menu as MenuIcon, Paperclip, RefreshCw, Reply, Search, Sparkles, Star, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Category, Folder, ThreadSummary } from "@shared/mail";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, EmptyState, Skeleton } from "@/components/ui/misc";
import { IconButton, Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { dateGroup, displayName, listDate } from "@/lib/format";
import { useThreadAction, useThreads, useDrafts, type ListArgs } from "@/lib/mail";
import { useSession } from "@/lib/session";
import { api, errorMessage } from "@/lib/api";
import { FOLDER_META } from "./nav";
import { useComposer } from "./composer/context";
import { useCopilot } from "./copilot/context";
import { BulkBar } from "./BulkBar";
import { toast } from "sonner";

const SWIPE_TRIGGER = 72;
const SWIPE_MAX = 120;

const EMPTY_HINT: Record<string, string> = {
  search: "Try different words, or toggle Ask AI to describe what you're looking for.",
  inbox: "You're all caught up.",
  snoozed: "Snooze a conversation (z) and it waits here until it's time to come back to your Inbox.",
  starred: "Star a conversation (s) to keep it close at hand.",
  drafts: "Drafts you start in FLUENT or Gmail show up here.",
  spam: "No spam. Nice.",
  trash: "Trash is empty. Gmail deletes items here after 30 days.",
};

const CATEGORY_CHIPS: Array<{ id: Category | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "primary", label: "Primary" },
  { id: "promotions", label: "Promotions" },
  { id: "social", label: "Social" },
  { id: "updates", label: "Updates" },
  { id: "forums", label: "Forums" },
];

export function useListArgs(): ListArgs & { nl?: string; explanation?: string } {
  const { folder = "inbox" } = useParams();
  const [p] = useSearchParams();
  const f = (folder === "label" || folder === "search" ? "all" : folder) as Folder;
  return {
    folder: folder === "label" ? "all" : f,
    account: p.get("account") ?? undefined,
    category: (p.get("category") as Category | null) ?? undefined,
    label: folder === "label" ? (p.get("label") ?? undefined) : undefined,
    q: [p.get("q"), p.get("unread") === "1" ? "is:unread" : ""].filter(Boolean).join(" ") || undefined,
    filter: p.get("filter") === "unanswered" ? "unanswered" : undefined,
    nl: p.get("nl") ?? undefined,
    explanation: p.get("why") ?? undefined,
  };
}

export function ThreadList({ onOpenSidebar, selectedKey, onThreadsChange }: { onOpenSidebar: () => void; selectedKey?: string; onThreadsChange?: (t: ThreadSummary[]) => void }) {
  const args = useListArgs();
  const { folder = "inbox" } = useParams();
  const [params, setParams] = useSearchParams();
  const { session, config } = useSession();
  const qc = useQueryClient();
  const isDrafts = folder === "drafts";
  const threads = useThreads(args, !isDrafts);
  const drafts = useDrafts(args.account, isDrafts);
  const action = useThreadAction();
  const navigate = useNavigate();
  const composer = useComposer();
  const [showStarred, setShowStarred] = useState(true);
  const [aiMode, setAiMode] = useState(Boolean(args.nl));
  const [searchText, setSearchText] = useState(args.nl ?? params.get("q") ?? "");
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  // While selecting, the mobile bulk bar owns the bottom edge, so the floating Copilot button steps aside.
  useEffect(() => {
    if (picked.size === 0) return;
    document.body.dataset.selecting = "";
    return () => { delete document.body.dataset.selecting; };
  }, [picked.size > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => threads.data?.pages.flatMap((p) => p.threads) ?? [], [threads.data]);
  const accountErrors = threads.data?.pages[0]?.errors ?? [];
  useEffect(() => {
    onThreadsChange?.(all);
  }, [all, onThreadsChange]);

  useEffect(() => {
    if (params.get("focus") === "search") {
      searchRef.current?.focus();
      const p = new URLSearchParams(params);
      p.delete("focus");
      setParams(p, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && threads.hasNextPage && !threads.isFetchingNextPage) void threads.fetchNextPage();
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [threads]);

  const title = folder === "label" ? (params.get("name") ?? "Label") : folder === "search" ? "Search" : FOLDER_META[folder as Folder]?.label ?? "Mail";
  const accountLabel = args.account ? session?.accounts?.find((a) => a.id === args.account)?.email : "All accounts";

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k);
    else p.set(k, v);
    setParams(p);
  };

  const submitSearch = async (e: FormEvent) => {
    e.preventDefault();
    const text = searchText.trim();
    const base = new URLSearchParams();
    if (args.account) base.set("account", args.account);
    if (!text) {
      navigate(`/app/inbox?${base}`);
      return;
    }
    if (!aiMode) {
      base.set("q", text);
      navigate(`/app/search?${base}`);
      return;
    }
    setSearching(true);
    try {
      const r = await api.post<{ gmailQuery: string; explanation: string; postFilter: "none" | "unanswered" }>("/ai/search", { query: text, accountId: args.account });
      base.set("q", r.gmailQuery);
      base.set("nl", text);
      base.set("why", r.explanation);
      if (r.postFilter === "unanswered") base.set("filter", "unanswered");
      navigate(`/app/search?${base}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  const starred = folder === "inbox" && !args.q ? all.filter((t) => t.starred) : [];
  const rest = folder === "inbox" && !args.q ? all.filter((t) => !t.starred) : all;
  const groups: Array<[string, ThreadSummary[]]> = [];
  for (const t of rest) {
    const g = folder === "search" ? "Results" : dateGroup(t.lastDate);
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(t);
    else groups.push([g, [t]]);
  }

  const keyOf = (t: ThreadSummary) => `${t.accountId}:${t.id}`;
  const ordered = [...(showStarred ? starred : []), ...groups.flatMap(([, items]) => items)];
  const pickedThreads = ordered.filter((t) => picked.has(keyOf(t)));
  const toggle = (t: ThreadSummary, range: boolean) => {
    const k = keyOf(t);
    setPicked((prev) => {
      const next = new Set(prev);
      if (range && anchor.current) {
        // Shift-click: select everything between the last clicked row and this one.
        const keys = ordered.map(keyOf);
        const i = keys.indexOf(anchor.current);
        const j = keys.indexOf(k);
        if (i >= 0 && j >= 0) for (const kk of keys.slice(Math.min(i, j), Math.max(i, j) + 1)) next.add(kk);
      } else if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    anchor.current = k;
  };
  // Selection is per list: clear it when the folder or search changes.
  useEffect(() => setPicked(new Set()), [folder, params]);
  // Drop selected rows that left the list (e.g. after archiving).
  useEffect(() => {
    setPicked((prev) => {
      const live = new Set(all.map(keyOf));
      const next = new Set([...prev].filter((k) => live.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [all]);
  // x toggles the open conversation, Esc clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (e.key === "x") {
        const cur = all.find((t) => keyOf(t) === selectedKey) ?? ordered[0];
        if (cur) { e.preventDefault(); toggle(cur, false); }
      } else if (e.key === "Escape" && picked.size) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPicked(new Set());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const open = (t: ThreadSummary, reply = false) => {
    const p = new URLSearchParams(params);
    if (reply) p.set("reply", "1");
    navigate(`/app/${folder}/${t.accountId}/${t.id}?${p}`);
  };

  return (
    <section aria-label={`${title} list`} className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <IconButton label="Open navigation" className="lg:hidden" onClick={onOpenSidebar}>
            <MenuIcon className="size-5" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold text-fg">
              {title} <span className="font-normal text-fg-3">– {accountLabel}</span>
            </h1>
          </div>
          <IconButton
            label="Refresh"
            onClick={() => { void qc.invalidateQueries({ queryKey: isDrafts ? ["drafts"] : ["threads"] }); void qc.invalidateQueries({ queryKey: ["labels"] }); }}
          >
            <RefreshCw className={cn("size-4", (threads.isRefetching || drafts.isRefetching) && "animate-spin")} />
          </IconButton>
        </div>

        {config?.ai && <AskCopilotBar />}

        <form onSubmit={submitSearch} role="search" className="relative">
          {aiMode ? <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-accent-ink" aria-hidden /> : <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />}
          <input
            ref={searchRef}
            id="mail-search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={aiMode ? "Ask: “invoice I got last month”" : "Search mail (Gmail syntax works)"}
            aria-label={aiMode ? "Natural-language search" : "Search mail"}
            className={cn(
              "h-9 w-full rounded-[10px] border bg-surface-2 pl-9 pr-[84px] text-[13.5px] text-fg placeholder:text-fg-3 outline-none focus:ring-2 focus:ring-[var(--accent-ring)]",
              aiMode ? "border-[var(--ai-border)]" : "border-line",
            )}
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {searching && <Loader2 className="size-4 animate-spin text-fg-3" aria-label="Searching" />}
            <button
              type="button"
              onClick={() => setAiMode((v) => !v)}
              aria-pressed={aiMode}
              disabled={!config?.ai}
              title={config?.ai ? "Toggle natural-language search" : "AI is not configured on this server"}
              className={cn("h-7 rounded-lg px-2 text-[12px] font-medium transition-colors disabled:opacity-40", aiMode ? "bg-accent text-white" : "text-fg-3 hover:bg-surface-3 hover:text-fg")}
            >
              Ask AI
            </button>
          </div>
        </form>

        {folder === "inbox" && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scroll-thin" role="group" aria-label="Categories">
            {CATEGORY_CHIPS.map((c) => (
              <Chip key={c.id} active={(args.category ?? "all") === c.id} onClick={() => setParam("category", c.id === "all" ? null : c.id)}>{c.label}</Chip>
            ))}
            <Chip active={params.get("unread") === "1"} onClick={() => setParam("unread", params.get("unread") === "1" ? null : "1")}>Unread</Chip>
          </div>
        )}

        {folder === "search" && (args.nl || args.q) && (
          <div className="ai-block rounded-xl px-3 py-2 text-[12.5px]">
            <div className="flex items-start gap-2">
              {args.nl ? <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-ink" aria-hidden /> : <Search className="mt-0.5 size-3.5 shrink-0 text-fg-3" aria-hidden />}
              <div className="min-w-0 flex-1 text-fg-2">
                {args.nl && <p className="text-fg">“{args.nl}”</p>}
                {args.explanation && <p>{args.explanation}</p>}
                <p className="mt-0.5 break-all font-mono text-[11.5px] text-fg-3">Gmail query: {args.q}{args.filter === "unanswered" ? " · only threads where the last message isn't yours" : ""}</p>
              </div>
              <Link to={args.account ? `/app/inbox?account=${args.account}` : "/app/inbox"} aria-label="Clear search" className="rounded p-0.5 text-fg-3 hover:text-fg"><X className="size-3.5" /></Link>
            </div>
          </div>
        )}
      </header>

      {accountErrors.length > 0 && (
        <div role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-fg-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span className="flex-1">{accountErrors.map((e) => e.message).join(" ")}</span>
          <Link to="/app/settings/accounts" className="shrink-0 font-medium text-accent-ink hover:underline">Fix</Link>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin" data-testid="thread-list">
        {isDrafts ? (
          <DraftsList drafts={drafts} onOpen={(d) => composer.open({ mode: "draft", accountId: d.accountId, draftId: d.draftId })} />
        ) : threads.isLoading ? (
          <ListSkeleton />
        ) : threads.isError ? (
          <EmptyState
            icon={<AlertTriangle className="size-5" />}
            title="Couldn't load your mail"
            description={errorMessage(threads.error)}
            action={<div className="flex gap-2"><Button onClick={() => void threads.refetch()}>Try again</Button><Link to="/app/settings/accounts"><Button variant="ghost">Account settings</Button></Link></div>}
          />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title={folder === "search" ? "No matching email" : `Nothing in ${title}`}
            description={EMPTY_HINT[folder] ?? "When there's mail here, it will show up instantly."}
          />
        ) : (
          <>
          {picked.size > 0 && !isDrafts && (
            <BulkBar
              selected={pickedThreads}
              folder={folder}
              allVisible={ordered.length > 0 && ordered.every((t) => picked.has(keyOf(t)))}
              onSelectAll={(on) => setPicked(on ? new Set(ordered.slice(0, 100).map(keyOf)) : new Set())}
              onClear={() => setPicked(new Set())}
            />
          )}
          <ul className={cn("pb-4", picked.size > 0 && "pb-24 lg:pb-4")} aria-label="Conversations">
            {starred.length > 0 && (
              <li>
                <GroupHeader label="Starred" action={<button type="button" className="flex items-center gap-1 text-[11.5px] text-fg-3 hover:text-fg" onClick={() => setShowStarred((v) => !v)} aria-expanded={showStarred}>{showStarred ? "Hide" : "Show"}<ChevronUp className={cn("size-3.5 transition-transform", !showStarred && "rotate-180")} /></button>} />
                {showStarred && <ul>{starred.map((t) => <Row key={`${t.accountId}:${t.id}`} t={t} picked={picked.has(`${t.accountId}:${t.id}`)} selecting={picked.size > 0} onPick={(range) => toggle(t, range)} selected={selectedKey === `${t.accountId}:${t.id}`} onOpen={() => open(t)} onSwipeReply={() => open(t, true)} onStar={() => action.mutate({ accountId: t.accountId, threadId: t.id, action: t.starred ? "unstar" : "star", folder: args.folder })} multiAccount={(session?.accounts?.length ?? 0) > 1 && !args.account} />)}</ul>}
              </li>
            )}
            {groups.map(([label, items]) => (
              <li key={label}>
                <GroupHeader label={label} />
                <ul>
                  {items.map((t) => (
                    <Row key={`${t.accountId}:${t.id}`} t={t} picked={picked.has(`${t.accountId}:${t.id}`)} selecting={picked.size > 0} onPick={(range) => toggle(t, range)} selected={selectedKey === `${t.accountId}:${t.id}`} onOpen={() => open(t)} onSwipeReply={() => open(t, true)} onStar={() => action.mutate({ accountId: t.accountId, threadId: t.id, action: t.starred ? "unstar" : "star", folder: args.folder })} multiAccount={(session?.accounts?.length ?? 0) > 1 && !args.account} />
                  ))}
                </ul>
              </li>
            ))}
            <div ref={sentinel} />
            {threads.hasNextPage && (
              <div className="flex justify-center py-3">
                <Button size="sm" variant="ghost" loading={threads.isFetchingNextPage} onClick={() => void threads.fetchNextPage()}>Load more</Button>
              </div>
            )}
          </ul>
          </>
        )}
      </div>
    </section>
  );
}

function GroupHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between bg-surface/95 px-4 pb-1.5 pt-3 backdrop-blur">
      <span className="text-[11.5px] font-medium text-fg-3">{label}</span>
      {action}
    </div>
  );
}

function Row({ t, selected, onOpen, onSwipeReply, onStar, multiAccount, picked, selecting, onPick }: {
  t: ThreadSummary; selected: boolean; onOpen: () => void; onSwipeReply: () => void; onStar: () => void; multiAccount: boolean;
  picked: boolean; selecting: boolean; onPick: (range: boolean) => void;
}) {
  const { session } = useSession();
  const accIdx = session?.accounts?.findIndex((a) => a.id === t.accountId) ?? 0;
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  // Long-press (touch) enters selection mode; while selecting, a tap toggles instead of opening.
  // Swipe left (touch) to reply: opens the conversation with the reply box focused and AI suggestions.
  const swipe = useRef<{ x: number; y: number; active: boolean; done: boolean } | null>(null);
  const [offset, setOffset] = useState(0);
  const onPointerMove = (e: React.PointerEvent) => {
    const s = swipe.current;
    if (!s || e.pointerType !== "touch" || selecting) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.active && dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      s.active = true;
      cancelPress();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (s.active) setOffset(Math.max(-SWIPE_MAX, Math.min(0, dx)));
  };
  const endSwipe = () => {
    const s = swipe.current;
    if (s?.active) {
      s.done = true;
      if (offset <= -SWIPE_TRIGGER) { navigator.vibrate?.(8); onSwipeReply(); }
    }
    setOffset(0);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    swipe.current = { x: e.clientX, y: e.clientY, active: false, done: false };
    const state = { fired: false, timer: 0 };
    state.timer = window.setTimeout(() => {
      state.fired = true;
      navigator.vibrate?.(10);
      onPick(false);
    }, 450);
    press.current = state;
  };
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  const click = (e: React.MouseEvent) => {
    if (swipe.current?.done) {
      swipe.current = null;
      e.preventDefault();
      return;
    }
    if (press.current?.fired) {
      press.current = null;
      e.preventDefault();
      return;
    }
    if (selecting || e.shiftKey) onPick(e.shiftKey);
    else onOpen();
  };
  return (
    // Off-screen rows skip layout and paint (content-visibility), a cheap stand-in for virtualization that
    // keeps find-in-page, keyboard focus and screen readers working on the full list.
    <li className="relative [contain-intrinsic-size:auto_78px] [content-visibility:auto]">
      {offset < 0 && (
        <div aria-hidden className={cn("absolute inset-y-0 right-2 flex items-center gap-1.5 rounded-xl px-4 text-[13px] font-medium transition-colors", offset <= -SWIPE_TRIGGER ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-ink")}>
          <Reply className="size-4" /> Reply
        </div>
      )}
      <div
        data-thread-id={t.id}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        data-picked={picked ? "" : undefined}
        className={cn(
          "group relative mx-2 flex cursor-pointer touch-pan-y select-none gap-3 rounded-xl px-2.5 py-[var(--row-py,12px)] transition-colors",
          offset ? "bg-surface" : "transition-transform",
          picked ? "bg-accent-soft ring-1 ring-inset ring-[var(--ai-border)]" : selected ? "bg-surface-3" : "hover:bg-surface-2",
        )}
        onClick={click}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { cancelPress(); endSwipe(); }}
        onPointerLeave={cancelPress}
        onPointerCancel={() => { cancelPress(); setOffset(0); }}
        onContextMenu={(e) => { if (press.current?.fired) e.preventDefault(); }}
      >
        <div className="flex w-5 flex-col items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStar(); }}
            aria-label={t.starred ? "Unstar conversation" : "Star conversation"}
            aria-pressed={t.starred}
            className={cn("rounded p-0.5 transition-colors", t.starred ? "text-amber-400" : "text-fg-3/60 hover:text-fg-2")}
          >
            <Star className="size-4" fill={t.starred ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="relative size-9 shrink-0">
          <span className={cn("block transition-opacity", (picked || selecting) ? "opacity-0" : "group-hover:opacity-0 group-focus-within:opacity-0")}>
            <Avatar name={displayName(t.from)} email={t.from.email} size={36} />
          </span>
          <button
            type="button"
            role="checkbox"
            aria-checked={picked}
            aria-label={`Select: ${t.subject || "(no subject)"}`}
            onClick={(e) => { e.stopPropagation(); onPick(e.shiftKey); }}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-full border transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
              picked ? "border-accent bg-accent text-accent-fg opacity-100" : "border-line-strong bg-surface-2 text-transparent",
              !picked && (selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"),
            )}
          >
            <Check className="size-4" />
          </button>
          {t.unread && !picked && <span className="pointer-events-none absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden />}
        </div>
        <button type="button" onClick={(e) => { e.stopPropagation(); click(e); }} className="min-w-0 flex-1 text-left outline-none" aria-current={selected ? "true" : undefined}>
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[13.5px]", t.unread ? "font-semibold text-fg" : "font-medium text-fg-2")}>
              {displayName(t.from)}
              {t.participants.length > 1 && <span className="font-normal text-fg-3"> +{t.participants.length - 1}</span>}
            </span>
            <time className={cn("shrink-0 text-[11.5px]", t.unread ? "text-fg-2" : "text-fg-3")} dateTime={t.lastDate}>{listDate(t.lastDate)}</time>
          </span>
          <span className={cn("mt-0.5 block truncate text-[13px]", t.unread ? "text-fg" : "text-fg-2")}>
            {t.important && <span className="mr-1 text-warning" title="Important" aria-label="Important">›</span>}
            {t.subject}
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-3">{t.snippet}</span>
            {multiAccount && <span className="size-1.5 shrink-0 rounded-full" style={{ background: ["#a78bfa", "#38bdf8", "#f472b6", "#34d399", "#fbbf24"][Math.max(0, accIdx) % 5] }} title="Account" aria-hidden />}
            {t.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-fg-3" aria-label="Has attachments" />}
            {t.messageCount > 1 && (
              <span className={cn("inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold", t.unread ? "bg-[#ef4444] text-white" : "bg-surface-3 text-fg-2")} aria-label={`${t.messageCount} messages`}>{t.messageCount}</span>
            )}
          </span>
        </button>
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1 p-3" aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-3 px-2 py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DraftsList({ drafts, onOpen }: { drafts: ReturnType<typeof useDrafts>; onOpen: (d: { accountId: string; draftId: string }) => void }) {
  if (drafts.isLoading) return <ListSkeleton />;
  if (drafts.isError) return <EmptyState icon={<AlertTriangle className="size-5" />} title="Couldn't load drafts" description={errorMessage(drafts.error)} action={<Button onClick={() => void drafts.refetch()}>Try again</Button>} />;
  const list = drafts.data?.drafts ?? [];
  if (list.length === 0) return <EmptyState icon={<Inbox className="size-5" />} title="No drafts" description="Drafts you save in FLUENT or Gmail appear here." />;
  return (
    <ul className="py-2" aria-label="Drafts">
      {list.map((d) => (
        <li key={d.draftId}>
          <button type="button" onClick={() => onOpen(d)} className="mx-2 flex w-[calc(100%-16px)] flex-col rounded-xl px-3 py-3 text-left hover:bg-surface-2">
            <span className="flex items-baseline gap-2">
              <span className="text-[12px] font-semibold text-danger">Draft</span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg-2">{d.to.map((a) => displayName(a)).join(", ") || "(no recipients)"}</span>
              <time className="text-[11.5px] text-fg-3" dateTime={d.date}>{listDate(d.date)}</time>
            </span>
            <span className="truncate text-[13px] text-fg">{d.subject || "(no subject)"}</span>
            <span className="truncate text-[12.5px] text-fg-3">{d.snippet}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The Copilot entry point at the top of every mail list: type an instruction and press Enter. */
function AskCopilotBar() {
  const copilot = useCopilot();
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        copilot.open(text.trim() || undefined, Boolean(text.trim()));
        setText("");
      }}
      className="group relative"
    >
      <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-accent-ink" aria-hidden />
      <label htmlFor="ask-copilot-bar" className="sr-only">Ask Copilot</label>
      <input
        id="ask-copilot-bar"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        placeholder="Ask Copilot. Try: archive all newsletters from last week"
        className="h-10 w-full rounded-[10px] border border-[var(--ai-border)] bg-accent-soft pl-9 pr-24 text-[13.5px] text-fg outline-none transition-shadow placeholder:text-ai-title/70 focus:ring-2 focus:ring-[var(--accent-ring)]"
      />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        <kbd className="hidden rounded border border-[var(--ai-border)] px-1.5 text-[10.5px] text-ai-title sm:inline">⌘J</kbd>
        <button type="submit" className="h-7 rounded-lg bg-accent px-2.5 text-[12px] font-medium text-accent-fg hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]">
          Ask
        </button>
      </div>
    </form>
  );
}
