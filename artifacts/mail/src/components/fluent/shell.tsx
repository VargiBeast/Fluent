import React, { type ReactNode, useState } from "react";
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
      <a href="/compose" className="compose-fab">
        Compose
      </a>
      <div id="more-sheet" className="sheet" role="dialog" aria-label="More destinations" hidden={!more}>
        <h2>More</h2>
        <div className="row-actions">
          <a className="button secondary" href="/sent">
            Sent
          </a>
          <a className="button secondary" href="/settings">
            Settings
          </a>
          <a className="button primary" href="/compose">
            Compose
          </a>
          <Button variant="secondary" type="button" onClick={() => setMore(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AppShell(props: { children: ReactNode; demo: boolean; email?: string }) {
  const [location, navigate] = useLocation();
  return <FluentChrome {...props} pathname={location} onNavigate={navigate} />;
}

export { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "./states";
