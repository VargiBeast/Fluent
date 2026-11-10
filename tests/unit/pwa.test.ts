import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
const sw = readFileSync("public/sw.js", "utf8");

function loadWorker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = { location: { origin: "https://fluent.example" }, addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn), skipWaiting: vi.fn(), clients: { claim: vi.fn() } };
  const caches = { open: vi.fn(async () => ({ addAll: vi.fn(), put: vi.fn() })), match: vi.fn(async () => undefined), keys: vi.fn(async () => []), delete: vi.fn() };
  const fetch = vi.fn(async () => ({ ok: true, type: "basic", clone: () => ({}) }));
  runInNewContext(sw, { self, caches, fetch, URL, Promise });
  const fire = (url: string, init: { method?: string; mode?: string } = {}) => {
    const respondWith = vi.fn();
    handlers.fetch!({ request: { url, method: init.method ?? "GET", mode: init.mode ?? "cors" }, respondWith });
    return respondWith;
  };
  return { fire, caches };
}

describe("PWA", () => {
  it("manifest is installable", () => {
    expect(manifest).toMatchObject({ short_name: "FLUENT", display: "standalone", start_url: "/app/inbox", scope: "/" });
    expect(manifest.theme_color).toBe("#0b0b0e");
    const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  });

  it("service worker never handles /api, OAuth or non-GET requests", () => {
    const { fire } = loadWorker();
    expect(fire("https://fluent.example/api/mail/threads")).not.toHaveBeenCalled();
    expect(fire("https://fluent.example/api/auth/google/start?mode=login", { mode: "navigate" })).not.toHaveBeenCalled();
    expect(fire("https://fluent.example/api/auth/google/callback?code=x", { mode: "navigate" })).not.toHaveBeenCalled();
    expect(fire("https://fluent.example/app/inbox", { method: "POST" })).not.toHaveBeenCalled();
    expect(fire("https://accounts.google.com/o/oauth2/v2/auth", { mode: "navigate" })).not.toHaveBeenCalled();
  });

  it("serves the static shell: network-first navigations, cache-first hashed assets", () => {
    const { fire } = loadWorker();
    expect(fire("https://fluent.example/app/inbox", { mode: "navigate" })).toHaveBeenCalledOnce();
    expect(fire("https://fluent.example/assets/index-abc.js")).toHaveBeenCalledOnce();
  });
});
