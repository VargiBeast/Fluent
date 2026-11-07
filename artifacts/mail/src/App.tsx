import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Route, Router as WouterRouter, Switch } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppShell, LoadingState } from "@/components/fluent/shell";
import { ToastProvider } from "@/components/fluent/toast";
import { ComposePage } from "@/pages/compose";
import { CopilotPage } from "@/pages/copilot";
import { InboxPage } from "@/pages/inbox";
import { LoginPage } from "@/pages/login";
import { OnboardingPage } from "@/pages/onboarding";
import { OverviewPage } from "@/pages/overview";
import { SettingsPage } from "@/pages/settings";
import { ThreadPage } from "@/pages/thread";
import { WelcomePage } from "@/pages/welcome";
import { useSession } from "@/lib/session";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Guard({ children, requireOnboarding = true }: { children: ReactNode; requireOnboarding?: boolean }) {
  const session = useSession();
  if (session.isLoading) return <LoadingState label="Checking session" />;
  if (!session.data?.authenticated || !session.data.user) return <Redirect href="/login" />;
  if (requireOnboarding && !session.data.user.onboarded) return <Redirect href="/onboarding" />;
  return (
    <AppShell demo={session.data.user.isDemo} email={session.data.user.email}>
      {children}
    </AppShell>
  );
}

function OnboardingGuard() {
  const session = useSession();
  if (session.isLoading) return <LoadingState label="Checking session" />;
  if (!session.data?.authenticated || !session.data.user) return <Redirect href="/login" />;
  return (
    <AppShell demo={session.data.user.isDemo} email={session.data.user.email}>
      <OnboardingPage />
    </AppShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={WelcomePage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/onboarding" component={OnboardingGuard} />
      <Route path="/overview">{() => <Guard><OverviewPage /></Guard>}</Route>
      <Route path="/inbox/:id">{() => <Guard><ThreadPage /></Guard>}</Route>
      <Route path="/inbox">{() => <Guard><InboxPage /></Guard>}</Route>
      <Route path="/sent">{() => <Guard><InboxPage view="sent" /></Guard>}</Route>
      <Route path="/copilot">{() => <Guard><CopilotPage /></Guard>}</Route>
      <Route path="/compose">{() => <Guard><ComposePage /></Guard>}</Route>
      <Route path="/settings">{() => <Guard requireOnboarding={false}><SettingsPage /></Guard>}</Route>
      <Route>{() => <Redirect href="/" />}</Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ErrorBoundary>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </ErrorBoundary>
      </ToastProvider>
    </QueryClientProvider>
  );
}
