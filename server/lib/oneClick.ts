import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { getEnv, isProduction } from "../env.js";

/**
 * RFC 8058 one-click unsubscribe: a single POST of `List-Unsubscribe=One-Click` to the https URL from the
 * sender's header. The URL is attacker-controlled, so: https on port 443 only, no credentials, every resolved
 * address must be public (checked at connect time, so DNS rebinding can't swap in an internal address),
 * no redirects followed, no cookies, short timeout, response body discarded.
 */
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, bits, "ipv4");
// Includes IPv4-compatible (::/96), 6to4 (2002::/16) and Teredo (2001::/32), which can embed private IPv4 addresses.
for (const [net, bits] of [["::", 96], ["::1", 128], ["2002::", 16], ["2001::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96], ["100::", 64]] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return !blocked.check(ip, "ipv4");
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return !blocked.check(mapped[1]!, "ipv4");
    return !blocked.check(ip, "ipv6");
  }
  return false;
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as Array<{ address: string; family: number }>;
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      const e = Object.assign(new Error("Blocked address"), { code: "EBLOCKED" });
      return callback(e, "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

export type OneClickOutcome = { ok: true; status: number } | { ok: false; reason: "blocked" | "network" | "status"; status?: number };

/** Origin of the local HTTP fake, allowed (over http, on loopback) only outside production. */
export function testOrigin(): string | null {
  const base = getEnv().FLUENT_TEST_GOOGLE_BASE;
  return !isProduction() && base ? new URL(base).origin : null;
}

export function oneClickTarget(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (testOrigin() === u.origin) return u;
  if (u.protocol !== "https:" || (u.port && u.port !== "443")) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) return null;
  if (!isIP(host) && (!host.includes(".") || /\.(local|localhost|internal|lan|home|corp)$/i.test(host) || host === "localhost")) return null;
  return u;
}

export function postOneClick(raw: string, timeoutMs = 10_000): Promise<OneClickOutcome> {
  const u = oneClickTarget(raw);
  if (!u) return Promise.resolve({ ok: false, reason: "blocked" });
  const isTest = testOrigin() === u.origin;
  const body = "List-Unsubscribe=One-Click";
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    const done = (o: OneClickOutcome) => {
      if (!settled) {
        settled = true;
        resolve(o);
      }
    };
    const req = mod.request(u, {
      method: "POST",
      ...(isTest ? {} : { lookup: safeLookup }),
      agent: false,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
        "user-agent": "FLUENT-Unsubscribe/1.0 (RFC 8058)",
        accept: "*/*",
      },
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode ?? 0;
      res.resume(); // discard the body
      res.on("end", () => undefined);
      done(status >= 200 && status < 300 ? { ok: true, status } : { ok: false, reason: "status", status });
    });
    req.on("timeout", () => {
      req.destroy();
      done({ ok: false, reason: "network" });
    });
    req.on("error", (e: NodeJS.ErrnoException) => done({ ok: false, reason: e.code === "EBLOCKED" ? "blocked" : "network" }));
    req.end(body);
  });
}
