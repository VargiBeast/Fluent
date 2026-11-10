import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import * as Tooltip from "@radix-ui/react-tooltip";
import "./styles/index.css";
import { ApiError } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { Splash } from "@/components/Splash";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LandingPage } from "@/pages/Landing";
import { NotFoundPage, PrivacyPage, TermsPage } from "@/pages/Legal";

const AppRoutes = lazy(() => import("@/app/AppRoutes"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={400}>
        <SessionProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/app/*" element={<Suspense fallback={<Splash />}><AppRoutes /></Suspense>} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
          <Toaster theme="dark" position="bottom-right" richColors closeButton />
        </SessionProvider>
      </Tooltip.Provider>
    </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
