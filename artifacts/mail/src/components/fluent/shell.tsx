import React, { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "./states";

const DESKTOP = [
  { href: "/overview", label: "Overview" },
  { href: "/inbox", label: "Inbox" },
  { href: "/copilot", label: "Copilot" },
  { href: "/sent", label: "Sent" },
  { href: "/settings", label: "Settings" },
];

const MOBILE = [
  { href: "/overview", label: "Overview" },
  { href: "/inbox", label: "Inbox" },
  { href: "/copilot", label: "Copilot" },
  { href: "/compose", label: "Compose" },
];

export function FluentChrome({
  children,
  demo,
  email,
  pathname,
  onNavigate,
}: {
  children?: ReactNode;
  demo: boolean;
  email?: string;
  pathname: string;
  onNavigate?: (href: string) => void;
}) {
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDialogElement>(null);
  const moreOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = moreRef.current;
    if (!dialog) return;
    if (more && !dialog.open) {
      moreOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!more && dialog.open) {
      dialog.close();
      moreOpener.current?.focus();
    }
  }, [more]);
  return (
    <div
      className="fluent-app"
      onClick={(event) => {
        if (!onNavigate) return;
        const anchor = (event.target as HTMLElement).closest("a");
        const href = anchor?.getAttribute("href");
        if (!href || !href.startsWith("/") || href.startsWith("//")) return;
        event.preventDefault();
        setMore(false);
        onNavigate(href);
      }}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {demo ? (
        <p className="demo-banner" role="status">
          Demo mailbox. These messages are synthetic and are not from Gmail.
          {email ? ` Signed in as ${email}.` : ""}
        </p>
      ) : null}
      <div className="fluent-frame">
        <aside className="desktop-nav" aria-label="Primary">
          <a href="/overview" className="brand">
            FLUENT
          </a>
          <p className="brand-tag">Email, without the effort.</p>
          <nav>
            {DESKTOP.map((item) => (
              <a
                key={item.href}
                className="nav-link"
                href={item.href}
                aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <a href="/compose" className="compose-link">
            Compose
          </a>
        </aside>
        <div className="workspace">
          <main id="main">{children}</main>
        </div>
      </div>
      <nav className="mobile-nav" aria-label="Primary mobile">
        {MOBILE.map((item) => (
          <a key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) ? "page" : undefined}>
            {item.label}
          </a>
        ))}
        <button type="button" className="more-button" aria-expanded={more} aria-controls="more-sheet" onClick={() => setMore(true)}>
          More
        </button>
      </nav>
      <dialog
        id="more-sheet"
        className="sheet"
        ref={moreRef}
        aria-label="More destinations"
        onClose={() => setMore(false)}
      >
        <h2>More</h2>
        <div className="row-actions">
          <a className="button secondary" href="/sent">
            Sent
          </a>
          <a className="button secondary" href="/settings">
            Settings
          </a>
          <Button variant="secondary" type="button" onClick={() => setMore(false)}>
            Close
          </Button>
        </div>
      </dialog>
    </div>
  );
}

export function AppShell(props: { children: ReactNode; demo: boolean; email?: string }) {
  const [location, navigate] = useLocation();
  return <FluentChrome {...props} pathname={location} onNavigate={navigate} />;
}

export { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "./states";
