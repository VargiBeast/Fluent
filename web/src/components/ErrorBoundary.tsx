import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MailIQ error boundary", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-[15px] font-semibold text-fg">Something went wrong</p>
          <p className="max-w-sm text-[13px] text-fg-3">MailIQ hit an unexpected error. Reload the page to continue.</p>
          <button type="button" className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
