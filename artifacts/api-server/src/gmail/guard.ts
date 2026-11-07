const ALLOWED: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/gmail\/v1\/users\/me\/profile$/ },
  { method: "GET", pattern: /^\/gmail\/v1\/users\/me\/threads$/ },
  { method: "GET", pattern: /^\/gmail\/v1\/users\/me\/threads\/[^/]+$/ },
  { method: "POST", pattern: /^\/gmail\/v1\/users\/me\/threads\/[^/]+\/modify$/ },
  { method: "POST", pattern: /^\/gmail\/v1\/users\/me\/threads\/[^/]+\/trash$/ },
  { method: "POST", pattern: /^\/gmail\/v1\/users\/me\/messages\/[^/]+\/modify$/ },
];

export class GmailPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailPathError";
  }
}

/** Rejects send, draft writes, and permanent delete before any network call. */
export function assertAllowedGmailRequest(method: string, pathname: string): void {
  const normalized = method.toUpperCase();
  if (normalized === "DELETE") {
    throw new GmailPathError("Permanent Gmail deletion is not implemented");
  }
  if (
    pathname.includes("/send") ||
    pathname.includes("/drafts") ||
    pathname.includes(":send")
  ) {
    throw new GmailPathError("Gmail send and draft writes are not implemented");
  }
  const ok = ALLOWED.some(
    (rule) => rule.method === normalized && rule.pattern.test(pathname),
  );
  if (!ok) {
    throw new GmailPathError("Gmail request is outside the FLUENT allowlist");
  }
}

export function assertSafePageToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  if (token.length > 512 || !/^[A-Za-z0-9_\-=:.]+$/.test(token)) {
    throw new GmailPathError("Invalid page token");
  }
  return token;
}
