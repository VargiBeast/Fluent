import { testOrigin } from "./oneClick.js";

/**
 * Parsing for List-Unsubscribe (RFC 2369) and List-Unsubscribe-Post (RFC 8058) headers.
 * Header values come from senders, so everything here is treated as hostile input.
 */
export interface ParsedUnsubscribe {
  /** https URL usable for RFC 8058 one-click (only when List-Unsubscribe-Post says so). */
  oneClickUrl: string | null;
  /** First https URL (one-click or a page to open). */
  httpsUrl: string | null;
  mailto: { address: string; subject: string; body: string } | null;
}

const MAX_URL = 2048;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function parseMailto(raw: string): ParsedUnsubscribe["mailto"] {
  const rest = raw.slice("mailto:".length);
  const [addrPart = "", query = ""] = rest.split("?", 2);
  const address = safeDecode(addrPart)?.trim().toLowerCase() ?? "";
  // One recipient only, and nothing that could smuggle headers.
  if (!address || address.length > 254 || address.includes(",") || CONTROL.test(address) || !EMAIL.test(address)) return null;
  const params = new URLSearchParams(query);
  const clean = (v: string | null, max: number) => (v ?? "").replace(/[\r\n\t]+/g, " ").replace(CONTROL, "").trim().slice(0, max);
  return { address, subject: clean(params.get("subject"), 200) || "Unsubscribe", body: clean(params.get("body"), 1000) };
}

function parseHttps(raw: string): string | null {
  if (raw.length > MAX_URL || CONTROL.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.username || u.password) return null;
    // The local HTTP fake (tests/E2E only, never in production) stands in for a sender's https endpoint.
    if (u.protocol !== "https:" && u.origin !== testOrigin()) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function parseListUnsubscribe(listUnsubscribe: string, listUnsubscribePost = ""): ParsedUnsubscribe | null {
  const entries = [...listUnsubscribe.matchAll(/<([^<>]*)>/g)].map((m) => m[1]!.trim()).slice(0, 5);
  let httpsUrl: string | null = null;
  let mailto: ParsedUnsubscribe["mailto"] = null;
  for (const e of entries) {
    if (/^mailto:/i.test(e)) mailto ??= parseMailto(`mailto:${e.slice(7)}`);
    else if (/^https?:/i.test(e)) httpsUrl ??= parseHttps(e);
  }
  if (!httpsUrl && !mailto) return null;
  const oneClick = /(^|[\s;,])List-Unsubscribe\s*=\s*One-Click(\s|$|[;,])/i.test(listUnsubscribePost.trim());
  return { oneClickUrl: oneClick ? httpsUrl : null, httpsUrl, mailto };
}
