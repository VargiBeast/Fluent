import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { Logo } from "@/components/ui/misc";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="flex h-full items-center justify-center"><Logo /></main>
  </StrictMode>,
);
