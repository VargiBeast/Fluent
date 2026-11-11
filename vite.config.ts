import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const apiPort = process.env.MAILIQ_API_PORT ?? "8787";

export default defineConfig({
  root: "web",
  publicDir: "../public",
  plugins: [react(), tailwindcss()],
  // Vercel Web Analytics is rendered only in builds made on Vercel (VERCEL=1), never locally or in tests.
  define: {
    __VERCEL_ANALYTICS__: JSON.stringify(process.env.VERCEL === "1"),
    __APP_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version),
    __APP_COMMIT__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7)),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.MAILIQ_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  preview: {
    port: Number(process.env.MAILIQ_WEB_PORT ?? 4173),
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/, priority: 30 },
            { name: "editor", test: /node_modules[\\/](@tiptap|prosemirror-[^\\/]+|orderedmap|rope-sequence|w3c-keyname|linkifyjs|markdown-it|mdurl|uc\.micro|entities|punycode\.js|linkify-it)[\\/]/, priority: 20 },
            { name: "ui", test: /node_modules[\\/](@radix-ui|@floating-ui|@tanstack|sonner|lucide-react|react-remove-scroll[^\\/]*|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|tslib|get-nonce|detect-node-es)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
