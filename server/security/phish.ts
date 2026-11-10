/**
 * Phishing and fake-invoice signals from one message. Pure and deterministic: headers, addresses, links and
 * attachment names only, no AI and no network. Each signal has a plain-language reason the reader shows as is.
 */
import type { SecurityAssessment, SecuritySignal } from "../../shared/security.js";

export interface PhishInput {
  fromName: string;
  fromEmail: string;
  replyTo: string[];
  subject: string;
  text: string;
  html: string | null;
  attachments: string[];
  /** All Authentication-Results header values, top (most recent hop) first. */
  authResults: string[];
}

const BRANDS: Record<string, string[]> = {
  paypal: ["paypal.com"], apple: ["apple.com", "icloud.com"], microsoft: ["microsoft.com", "office.com", "outlook.com", "live.com"],
  google: ["google.com", "gmail.com"], amazon: ["amazon.com", "amazon.de", "amazon.co.uk", "amazon.se"], netflix: ["netflix.com"],
  dhl: ["dhl.com", "dhl.de", "dhl.no"], fedex: ["fedex.com"], ups: ["ups.com"], docusign: ["docusign.com", "docusign.net"],
  dropbox: ["dropbox.com"], linkedin: ["linkedin.com"], facebook: ["facebook.com", "facebookmail.com"], instagram: ["instagram.com"],
  stripe: ["stripe.com"], revolut: ["revolut.com"], vipps: ["vipps.no"], posten: ["posten.no"], bankid: ["bankid.no"],
  nordea: ["nordea.com", "nordea.no"], dnb: ["dnb.no"], coinbase: ["coinbase.com"], binance: ["binance.com"],
};
// Typosquats of these are common; for the rest only exact names count, so ordinary words (poster, striker) don't trip it.
const TYPO_BRANDS = new Set(["paypal", "google", "amazon", "netflix", "docusign", "dropbox", "linkedin", "facebook", "instagram", "coinbase", "binance", "microsoft", "revolut"]);
// Legitimate infrastructure whose names contain a brand.
const KNOWN_GOOD = /(^|\.)(amazonaws\.com|amazon-adsystem\.com|googleusercontent\.com|googleapis\.com|google-analytics\.com|googlemail\.com|googlegroups\.com|microsoftonline\.com|office365\.com|paypal-communication\.com|paypalobjects\.com|linkedin-ei\.com|fbcdn\.net)$/i;
const RISKY_ATTACHMENT = /\.(html?|shtml|svg|zip|rar|7z|iso|img|exe|scr|js|jse|vbs|bat|cmd|msi|lnk|hta|docm|xlsm)$/i;
const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at)$/i;
const MONEY = /\b(invoice|faktura|payment|betaling|overdue|past due|wire transfer|bank (details|account)|iban|remittance|outstanding balance)\b/i;
const CHANGED_BANK = /\b(new|updated|changed) (bank|banking|account|payment) (details|information|account)\b|\bchanged our bank\b|\bupdate (the|our) (bank|payment) details\b/i;
const URGENT = /\b(urgent|immediately|within 24 hours|account (will be )?(suspended|locked|closed)|verify your (account|identity|password)|unusual (sign-in|activity)|final notice)\b/i;
const CREDENTIALS = /\b(confirm|verify|update|re-?enter) (your )?(password|login|credentials|card details|payment information)\b/i;

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase().replace(/\.$/, "") ?? "";
/** example.co.uk -> example.co.uk, mail.example.com -> example.com (good enough for comparisons, no PSL). */
function registrable(host: string): string {
  const p = host.toLowerCase().split(".").filter(Boolean);
  if (p.length <= 2) return p.join(".");
  const sld2 = /^(co|com|org|net|ac|gov|edu)$/.test(p[p.length - 2]!) && p[p.length - 1]!.length === 2;
  return p.slice(sld2 ? -3 : -2).join(".");
}
const label = (host: string) => registrable(host).split(".")[0] ?? "";

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length]![b.length]!;
}
const deconfuse = (s: string) => s.replace(/0/g, "o").replace(/[1l|]/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/rn/g, "m").replace(/vv/g, "w");
const isOfficial = (host: string, brand: string) => BRANDS[brand]!.some((d) => host === d || host.endsWith(`.${d}`));

/** A brand this host imitates without being it, e.g. paypa1.com, paypal-secure.net, xn--pypal-4ve.com. */
export function lookalikeOf(host: string): string | null {
  host = host.toLowerCase();
  if (KNOWN_GOOD.test(host)) return null;
  const l = label(host);
  const dl = deconfuse(l);
  for (const brand of Object.keys(BRANDS)) {
    if (isOfficial(host, brand)) return null;
  }
  for (const brand of Object.keys(BRANDS)) {
    if (l === brand) return brand; // right name, wrong TLD (paypal.co instead of paypal.com)
    if (dl === brand && dl !== l) return brand; // paypa1, g00gle
    if (TYPO_BRANDS.has(brand) && l.length >= brand.length && editDistance(dl, brand) === 1) return brand; // paypall, amazom
    if (brand.length >= 5 && dl.split("-").includes(brand)) return brand; // paypal-secure, secure-amazon, paypa1-login
  }
  return null;
}

function parseAuth(values: string[]): { spf?: string; dkim?: string; dmarc?: string } {
  // Gmail prepends its own header; prefer the one from mx.google.com so a forged lower header can't vouch for itself.
  const v = values.find((x) => /^\s*mx\.google\.com\b/i.test(x)) ?? values[0];
  if (!v) return {};
  const get = (k: string) => new RegExp(`\\b${k}=([a-z]+)`, "i").exec(v)?.[1]?.toLowerCase();
  return { spf: get("spf"), dkim: get("dkim"), dmarc: get("dmarc") };
}

interface Link { href: string; host: string; text: string }
function links(html: string | null): Link[] {
  if (!html) return [];
  const out: Link[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[2]!.replace(/&amp;/g, "&").trim();
    if (!/^https?:\/\//i.test(href)) continue;
    let host = "";
    try { host = new URL(href).hostname.toLowerCase(); } catch { continue; }
    out.push({ href, host, text: m[3]!.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() });
    if (out.length >= 200) break;
  }
  return out;
}

const WEIGHT = { high: 3, medium: 2, low: 1 } as const;

export function assessMessage(m: PhishInput): SecurityAssessment {
  const signals: SecuritySignal[] = [];
  const add = (code: string, severity: SecuritySignal["severity"], text: string) => {
    if (!signals.some((s) => s.code === code)) signals.push({ code, severity, text });
  };
  const fromHost = domainOf(m.fromEmail);
  const body = `${m.subject}\n${m.text}`;

  // 1. Sender authentication, as checked by Gmail.
  const auth = parseAuth(m.authResults);
  if (auth.dmarc === "fail") add("dmarc_fail", "high", `Gmail couldn't verify that this really comes from ${fromHost} (DMARC failed).`);
  if (auth.spf === "fail" || auth.spf === "softfail") add("spf_fail", "medium", `The server that sent this isn't allowed to send for ${fromHost} (SPF ${auth.spf}).`);
  if (auth.dkim === "fail") add("dkim_fail", "medium", "The message's digital signature doesn't match (DKIM failed), so it may have been altered or forged.");

  // 2. Who it claims to be.
  const look = fromHost ? lookalikeOf(fromHost) : null;
  if (look) add("lookalike_sender", "high", `The sender's domain ${fromHost} looks like ${look} but isn't one of ${look}'s real domains.`);
  if (/(^|\.)xn--/.test(fromHost)) add("punycode_sender", "high", `The sender's domain ${fromHost} uses look-alike international characters.`);
  const named = Object.keys(BRANDS).find((b) => new RegExp(`\\b${b}\\b`, "i").test(m.fromName));
  if (named && fromHost && !isOfficial(fromHost, named) && !look) add("brand_name_mismatch", "medium", `The name says “${m.fromName}”, but it was sent from ${fromHost}, which isn't ${named}.`);
  const nameEmail = /[\w.+-]+@([\w-]+\.[\w.-]+)/.exec(m.fromName)?.[1]?.toLowerCase();
  if (nameEmail && registrable(nameEmail) !== registrable(fromHost)) add("name_shows_other_address", "medium", `The sender name shows an address at ${nameEmail}, but it really comes from ${fromHost}.`);
  const reply = m.replyTo.map(domainOf).find((d) => d && registrable(d) !== registrable(fromHost));
  if (reply) add("reply_to_mismatch", "medium", `Replies would go to ${reply}, not to ${fromHost} where it came from.`);

  // 3. Links.
  const ls = links(m.html);
  for (const l of ls) {
    const shown = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]|$)/i.exec(l.text)?.[1]?.toLowerCase();
    if (shown && registrable(shown) !== registrable(l.host)) {
      // Newsletters route links through click trackers, so a mismatch alone is a caution; pretending to be a
      // known brand's site is a real red flag.
      const brand = Object.keys(BRANDS).find((b) => isOfficial(shown, b) || lookalikeOf(shown) === b);
      if (brand && !isOfficial(l.host, brand)) add("link_text_mismatch", "high", `A link shows ${shown} but actually goes to ${l.host}.`);
      else add("link_text_mismatch", "medium", `A link shows ${shown} but actually goes to ${l.host}.`);
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(l.host) || l.host.startsWith("[")) add("ip_link", "medium", `A link goes to a bare IP address (${l.host}) instead of a website name.`);
    const ll = lookalikeOf(l.host);
    if (ll) add("lookalike_link", "high", `A link goes to ${l.host}, which imitates ${ll}.`);
    if (SHORTENERS.test(l.host)) add("shortened_link", "low", `A link is shortened (${l.host}), which hides where it really goes.`);
  }

  // 4. Attachments and content.
  const risky = m.attachments.find((a) => RISKY_ATTACHMENT.test(a));
  if (risky) add("risky_attachment", "high", `The attachment “${risky.slice(0, 80)}” is a file type often used to deliver malware or fake login pages.`);
  if (CREDENTIALS.test(body)) add("asks_credentials", "medium", "It asks you to confirm a password, login or card details. Real companies don't ask for these by email.");
  if (URGENT.test(body)) add("urgency", "low", "It pushes you to act fast, a common pressure tactic.");
  const money = MONEY.test(body);
  if (money && CHANGED_BANK.test(body)) add("changed_bank_details", "high", "It says the bank details have changed. That's the classic fake-invoice trick: confirm by phone using a number you already have.");
  const score = signals.reduce((n, s) => n + WEIGHT[s.severity], 0);
  // A payment request is only suspicious alongside other red flags; on its own it's just an invoice.
  if (money && score >= 2 && !signals.some((s) => s.code === "changed_bank_details")) add("payment_with_red_flags", "medium", "It asks for a payment and shows other warning signs. Don't pay from this email; check with the sender another way.");

  const total = signals.reduce((n, s) => n + WEIGHT[s.severity], 0);
  const level = signals.some((s) => s.severity === "high") || total >= 5 ? "danger" : total >= 2 ? "caution" : "safe";
  const auths = auth.spf || auth.dkim || auth.dmarc ? { spf: auth.spf ?? null, dkim: auth.dkim ?? null, dmarc: auth.dmarc ?? null } : null;
  return { level, signals: signals.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity]).slice(0, 8), auth: auths };
}
