import React from "react";

export function PageHeader({ eyebrow, title, lede }: { eyebrow?: string; title: string; lede?: string }) {
  return (
    <header className="page-header">
      {eyebrow ? <p className="badge">{eyebrow}</p> : null}
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
    <div role="status" aria-busy="true">
      <p className="hint">{label}</p>
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

export function Button({
  children,
  variant = "secondary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button className={`button ${variant}`} {...props}>
      {children}
    </button>
  );
}
