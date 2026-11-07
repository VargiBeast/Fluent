import React, { type ReactNode } from "react";
import { useLocation } from "wouter";

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
  { href: "/settings", label: "Settings" },
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
  return (
    <div
      className="fluent-app"
      onClick={(event) => {
        if (!onNavigate) return;
        const anchor = (event.target as HTMLElement).closest("a");
        const href = anchor?.getAttribute("href");
        if (!href || !href.startsWith("/") || href.startsWith("//")) return;
        event.preventDefault();
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
        <main id="main">{children}</main>
      </div>
      <nav className="mobile-nav" aria-label="Primary mobile">
        {MOBILE.map((item) => (
          <a
            key={item.href}
            href={item.href}
            aria-current={pathname.startsWith(item.href) ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <a href="/compose" className="compose-fab">
        Compose
      </a>
    </div>
  );
}

export function AppShell({
  children,
  demo,
  email,
}: {
  children: ReactNode;
  demo: boolean;
  email?: string;
}) {
  const [location, navigate] = useLocation();
  return (
    <FluentChrome demo={demo} email={email} pathname={location} onNavigate={navigate}>
      {children}
    </FluentChrome>
  );
}

export function PageHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {lede ? <p>{lede}</p> : null}
    </header>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state" role="status">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="error-state" role="alert">
      <h2>Something went wrong</h2>
      <p>{message}</p>
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <p className="loading-state" role="status">
      {label}
    </p>
  );
}
