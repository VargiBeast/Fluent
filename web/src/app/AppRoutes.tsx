import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { FOLDERS } from "@shared/mail";
import { NotFoundPage } from "@/pages/Legal";
import { AppLayout } from "./AppLayout";
import { MailView } from "./MailView";
import { Skeleton } from "@/components/ui/misc";

// Mail is the landing view and stays in this chunk; the other pages load on demand.
const OverviewPage = lazy(() => import("./Overview").then((m) => ({ default: m.OverviewPage })));
const OnboardingPage = lazy(() => import("./Onboarding").then((m) => ({ default: m.OnboardingPage })));
const SettingsPage = lazy(() => import("./settings/Settings").then((m) => ({ default: m.SettingsPage })));

const Page = ({ children }: { children: ReactNode }) => <Suspense fallback={<div className="p-6"><Skeleton className="h-6 w-48" /></div>}>{children}</Suspense>;

const MAIL_FOLDERS = new Set<string>([...FOLDERS, "label", "search"]);

function FolderRoute() {
  const { folder } = useParams();
  return folder && MAIL_FOLDERS.has(folder) ? <MailView /> : <NotFoundPage />;
}

/** Everything under /app, loaded as a separate chunk so the public pages stay light. */
export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/app/inbox" replace />} />
        <Route path="onboarding" element={<Page><OnboardingPage /></Page>} />
        <Route path="overview" element={<Page><OverviewPage /></Page>} />
        <Route path="settings" element={<Page><SettingsPage /></Page>} />
        <Route path="settings/:section" element={<Page><SettingsPage /></Page>} />
        <Route path=":folder" element={<FolderRoute />} />
        <Route path=":folder/:accountId/:threadId" element={<FolderRoute />} />
      </Route>
    </Routes>
  );
}
