import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const apiPort = process.env.FLUENT_API_PORT ?? "8787";

export default defineConfig({
  root: "web",
  publicDir: "../public",
  plugins: [react(), tailwindcss()],
  // Vercel Web Analytics is rendered only in builds made on Vercel (VERCEL=1), never locally or in tests.
  define: { __VERCEL_ANALYTICS__: JSON.stringify(process.env.VERCEL === "1") },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.FLUENT_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  preview: {
    port: Number(process.env.FLUENT_WEB_PORT ?? 4173),
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
});
