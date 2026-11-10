import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { simpleParser } from "mailparser";

/** HTTP-level fake of the Microsoft identity platform (common authority) and Graph /me. */
export interface FakeMicrosoft {
  url: string;
  state: {
    clientId: string;
    clientSecret: string;
    /** Scopes the token endpoint grants (defaults to everything FLUENT asks for). */
    grantScope: string;
    issueRefreshToken: boolean;
    profile: { id: string; displayName: string; mail: string | null; userPrincipalName: string };
    lastAuthorize: URLSearchParams | null;
    tokens: Map<string, string>; // access token -> profile id
    /** Refresh tokens currently valid (rotated on every use, like Microsoft). */
    refreshTokens: Set<string>;
    refreshCount: number;
    mail: Map<string, FakeGraphMessage>;
    seq: number;
    sent: string[]; // raw MIME handed to /me/sendMail
    /** Headers of every Graph mail request (to check Prefer / auth). */
    requests: Array<{ method: string; path: string; prefer: string }>;
  };
  addMessage(m: { folder: WellKnown; mime: string; isRead?: boolean; flagged?: boolean; importance?: string; isDraft?: boolean; received?: string }): Promise<string>;
  close(): Promise<void>;
}

export type WellKnown = "inbox" | "sentitems" | "drafts" | "archive" | "junkemail" | "deleteditems";
export interface FakeGraphMessage {
  id: string; folder: WellKnown; isRead: boolean; flagged: boolean; importance: string; isDraft: boolean; mime: string;
  received: string; seq: number; subject: string; preview: string; from: { name: string; address: string } | null; to: Array<{ name: string; address: string }>;
  /** Folder the message was in at its last change (for delta @removed). */
  wasIn: WellKnown;
}
const WK: WellKnown[] = ["inbox", "sentitems", "drafts", "archive", "junkemail", "deleteditems"];

export async function startFakeMicrosoft(): Promise<FakeMicrosoft> {
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();
  const state: FakeMicrosoft["state"] = {
    clientId: "ms-client-id", clientSecret: "ms-client-secret", grantScope: "Mail.ReadWrite Mail.Send User.Read offline_access", issueRefreshToken: true,
    profile: { id: "00000000-0000-0000-0000-00000000a1ce", displayName: "Alex Outlook", mail: "alex@outlook.example", userPrincipalName: "alex@outlook.example" },
    lastAuthorize: null, tokens: new Map(), refreshTokens: new Set(), refreshCount: 0, mail: new Map(), seq: 1, sent: [], requests: [],
  };
  // Real Graph ids are base64 with "+", "/" and "=": make the fake's ids look the same.
  const newId = () => `AAMkAD${randomBytes(90).toString("base64").replace(/=+$/, "")}+/A==`;
  async function addMessage(m: Parameters<FakeMicrosoft["addMessage"]>[0]): Promise<string> {
    const p = await simpleParser(m.mime);
    const one = (v: typeof p.to) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((o) => o.value).map((x) => ({ name: x.name ?? "", address: x.address ?? "" }));
    const id = newId();
    state.mail.set(id, {
      id, folder: m.folder, wasIn: m.folder, isRead: m.isRead ?? false, flagged: m.flagged ?? false, importance: m.importance ?? "normal", isDraft: m.isDraft ?? false,
      mime: m.mime, received: m.received ?? new Date().toISOString(), seq: state.seq++, subject: p.subject ?? "", preview: (p.text ?? "").slice(0, 120),
      from: one(p.from)[0] ?? null, to: one(p.to),
    });
    return id;
  }
  const view = (m: FakeGraphMessage) => ({
    id: m.id, subject: m.subject, bodyPreview: m.preview, from: m.from ? { emailAddress: m.from } : undefined, toRecipients: m.to.map((x) => ({ emailAddress: x })),
    receivedDateTime: m.received, isRead: m.isRead, isDraft: m.isDraft, importance: m.importance, flag: { flagStatus: m.flagged ? "flagged" : "notFlagged" },
    hasAttachments: /content-disposition:\s*attachment/i.test(m.mime), parentFolderId: `fld-${m.folder}`,
  });
  const touch = (m: FakeGraphMessage) => { m.seq = state.seq++; };
  const filterOk = (m: FakeGraphMessage, f: string | null) => !f || f.split(" and ").every((c) =>
    c === "isRead eq false" ? !m.isRead : c === "isRead eq true" ? m.isRead : c === "flag/flagStatus eq 'flagged'" ? m.flagged
      : c === "importance eq 'high'" ? m.importance === "high" : c.startsWith("receivedDateTime ge ") ? m.received >= c.slice(20) : false);
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "x"}`);
    const json = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && url.pathname === "/common/oauth2/v2.0/authorize") {
      state.lastAuthorize = url.searchParams;
      if (url.searchParams.get("code_challenge_method") !== "S256") return json(400, { error: "invalid_request" });
      const code = randomBytes(12).toString("hex");
      codes.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", redirectUri: url.searchParams.get("redirect_uri") ?? "", clientId: url.searchParams.get("client_id") ?? "" });
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/common/oauth2/v2.0/token") {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const p = new URLSearchParams(body);
        if (p.get("client_id") !== state.clientId || p.get("client_secret") !== state.clientSecret) return json(401, { error: "invalid_client" });
        if (p.get("grant_type") === "refresh_token") {
          if (!state.refreshTokens.delete(p.get("refresh_token") ?? "")) return json(400, { error: "invalid_grant" });
          state.refreshCount++;
        }
        if (p.get("grant_type") === "authorization_code") {
          const c = codes.get(p.get("code") ?? "");
          codes.delete(p.get("code") ?? "");
          const verifier = p.get("code_verifier") ?? "";
          const challenge = createHash("sha256").update(verifier).digest("base64url");
          if (!c || c.challenge !== challenge || c.redirectUri !== p.get("redirect_uri") || c.clientId !== state.clientId) return json(400, { error: "invalid_grant" });
        } else if (p.get("grant_type") !== "refresh_token") return json(400, { error: "unsupported_grant_type" });
        const access = randomBytes(16).toString("hex");
        state.tokens.set(access, state.profile.id);
        const refresh = `rt-${randomBytes(8).toString("hex")}`;
        if (state.issueRefreshToken) state.refreshTokens.add(refresh);
        return json(200, { token_type: "Bearer", expires_in: 3600, scope: state.grantScope, access_token: access, ...(state.issueRefreshToken ? { refresh_token: refresh } : {}) });
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/graph/v1.0/me") {
      const tok = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!state.tokens.has(tok)) return json(401, { error: { code: "InvalidAuthenticationToken" } });
      return json(200, state.profile);
    }
    if (url.pathname.startsWith("/graph/v1.0/me/")) {
      const tok = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!state.tokens.has(tok)) return json(401, { error: { code: "InvalidAuthenticationToken" } });
      state.requests.push({ method: req.method ?? "GET", path: url.pathname, prefer: String(req.headers.prefer ?? "") });
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        void graphMail(req.method ?? "GET", url, body, json, (status, data) => { res.writeHead(status, { "content-type": "application/octet-stream" }); res.end(data); })
          .catch(() => json(500, { error: { code: "fake_error" } }));
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  async function graphMail(method: string, url: URL, body: string, json: (s: number, b: unknown) => void, raw: (s: number, d: string) => void): Promise<void> {
    const parts = url.pathname.slice("/graph/v1.0/me/".length).split("/").map(decodeURIComponent);
    const q = url.searchParams;
    const page = (list: FakeGraphMessage[]) => {
      const top = Number(q.get("$top") ?? 10);
      const skip = Number(q.get("$skip") ?? 0);
      let l = list.filter((m) => filterOk(m, q.get("$filter")));
      const search = q.get("$search")?.replace(/^"|"$/g, "").toLowerCase();
      if (search) l = l.filter((m) => `${m.subject} ${m.preview} ${m.from?.address}`.toLowerCase().includes(search));
      l.sort((a, b) => b.received.localeCompare(a.received));
      const out = l.slice(skip, skip + top);
      const next = !search && skip + top < l.length ? `${url.origin}${url.pathname}?$skip=${skip + top}` : undefined;
      return json(200, { value: out.map(view), ...(next ? { "@odata.nextLink": next } : {}) });
    };
    const all = [...state.mail.values()].filter((m) => WK.includes(m.folder));
    if (parts[0] === "mailFolders" && WK.includes(parts[1] as WellKnown)) {
      const wk = parts[1] as WellKnown;
      const inFolder = all.filter((m) => m.folder === wk);
      if (parts.length === 2 && method === "GET") return json(200, { id: `fld-${wk}`, unreadItemCount: inFolder.filter((m) => !m.isRead).length, totalItemCount: inFolder.length });
      if (parts[2] === "messages" && parts[3] === "delta" && method === "GET") {
        const token = Number(q.get("$deltatoken") ?? 0);
        const changed = token ? [...state.mail.values()].filter((m) => m.seq >= token && (m.folder === wk || m.wasIn === wk)) : inFolder.filter((m) => filterOk(m, q.get("$filter")));
        const value = changed.map((m) => (m.folder === wk ? view(m) : { id: m.id, "@removed": { reason: "changed" } }));
        return json(200, { value, "@odata.deltaLink": `${url.origin}${url.pathname}?$deltatoken=${state.seq}` });
      }
      if (parts[2] === "messages" && parts.length === 3 && method === "GET") return page(inFolder);
    }
    if (parts[0] === "messages" && parts.length === 1) {
      if (method === "GET") return page(all);
      if (method === "POST") {
        const id = await addMessage({ folder: "drafts", mime: Buffer.from(body, "base64").toString(), isDraft: true, isRead: true });
        return json(201, view(state.mail.get(id)!));
      }
    }
    if (parts[0] === "sendMail" && method === "POST") {
      const mime = Buffer.from(body, "base64").toString();
      state.sent.push(mime);
      await addMessage({ folder: "sentitems", mime: mime.replace(/^Bcc:.*\r?\n/im, ""), isRead: true });
      return json(202, {});
    }
    if (parts[0] === "messages" && parts[1]) {
      const m = state.mail.get(parts[1]);
      if (!m || !WK.includes(m.folder)) return json(404, { error: { code: "ErrorItemNotFound" } });
      if (parts.length === 2 && method === "GET") return json(200, view(m));
      if (parts[2] === "$value" && method === "GET") return raw(200, m.mime);
      if (parts.length === 2 && method === "PATCH") {
        const p = JSON.parse(body) as { isRead?: boolean; flag?: { flagStatus: string }; importance?: string };
        if (p.isRead !== undefined) m.isRead = p.isRead;
        if (p.flag) m.flagged = p.flag.flagStatus === "flagged";
        if (p.importance) m.importance = p.importance;
        touch(m);
        return json(200, view(m));
      }
      if (parts.length === 2 && method === "DELETE") { state.mail.delete(m.id); return json(204, {}); }
      if (parts[2] === "move" && method === "POST") {
        const dest = (JSON.parse(body) as { destinationId: WellKnown }).destinationId;
        if (!WK.includes(dest)) return json(400, { error: { code: "ErrorInvalidIdMalformed" } });
        // Moving gives the message a new id in Exchange.
        state.mail.delete(m.id);
        const id = newId();
        state.mail.set(id, { ...m, id, wasIn: m.folder, folder: dest });
        touch(state.mail.get(id)!);
        // Leave a tombstone so delta reports the removal from the old folder.
        state.mail.set(m.id, { ...m, folder: "__gone" as WellKnown, wasIn: m.folder, seq: state.seq++ });
        return json(201, view(state.mail.get(id)!));
      }
    }
    json(400, { error: { code: "BadRequest" } });
  }

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state, addMessage, close: () => new Promise((r) => server.close(() => r())) };
}
