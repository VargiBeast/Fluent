import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { FOLDERS } from "@shared/mail";
import { NotFoundPage } from "@/pages/Legal";
import { AppLayout } from "./AppLayout";
import { MailView } from "./MailView";
import { OverviewPage } from "./Overview";
import { OnboardingPage } from "./Onboarding";
import { SettingsPage } from "./settings/Settings";

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
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/:section" element={<SettingsPage />} />
        <Route path=":folder" element={<FolderRoute />} />
        <Route path=":folder/:accountId/:threadId" element={<FolderRoute />} />
      </Route>
    </Routes>
  );
}
