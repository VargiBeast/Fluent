import { Component, type ErrorInfo, type ReactNode } from "react";

/** Last-resort boundary so a rendering bug shows a recoverable screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("FLUENT UI error", error.message, info.componentStack?.split("\n").slice(0, 4).join("\n"));
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
        <p className="max-w-sm text-[13.5px] text-fg-3">FLUENT hit an unexpected error. Your mail is safe in Gmail — reload to continue.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-2 rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-white">Reload</button>
      </div>
    );
  }
}
