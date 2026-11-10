/**
 * HTTP-level fake of Google OAuth 2.0 / OIDC, the Gmail REST API and the xAI Responses API.
 * Used ONLY by tests and the local E2E harness (FLUENT_TEST_* overrides are ignored in production).
 * The fake speaks the same wire formats FLUENT's real clients use, so tests exercise the
 * real HTTP code paths: PKCE verification, token refresh, JWT signature checks, MIME parsing.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { FakeGmail, type Mailbox } from "./gmail.js";
import { fakeAiRespond } from "./ai.js";

export interface FakeIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  emailVerified?: boolean;
}

export interface FakeGoogleState {
  clientId: string;
  clientSecret: string;
  nextIdentity: FakeIdentity;
  grantedScopes: string | null; // null = grant everything requested
  failRefresh: boolean;
  codes: Map<string, { challenge: string; nonce: string; redirectUri: string; identity: FakeIdentity; scope: string }>;
  accessTokens: Map<string, { email: string; exp: number }>;
  refreshTokens: Map<string, string>; // refresh -> email
  revoked: string[];
  gmail: FakeGmail;
  aiRequests: Array<{ task: string; input: string }>;
  aiFail: boolean;
  requestLog: Array<{ method: string; path: string }>;
}

export interface FakeGoogle {
  url: string;
  state: FakeGoogleState;
  close(): Promise<void>;
  mailbox(email: string): Mailbox;
}

export const DEFAULT_IDENTITY: FakeIdentity = { sub: "1001", email: "alex@fluent.test", name: "Alex Morgan" };

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/html" : "application/json", ...headers });
  res.end(data);
}

export async function startFakeGoogle(opts: { port?: number; clientId?: string; clientSecret?: string; seed?: boolean } = {}): Promise<FakeGoogle> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "fake-key-1", alg: "RS256", use: "sig" };
  const state: FakeGoogleState = {
    clientId: opts.clientId ?? "fake-client-id.apps.googleusercontent.com",
    clientSecret: opts.clientSecret ?? "fake-client-secret",
    nextIdentity: DEFAULT_IDENTITY,
    grantedScopes: null,
    failRefresh: false,
    codes: new Map(),
    accessTokens: new Map(),
    refreshTokens: new Map(),
    revoked: [],
    gmail: new FakeGmail(),
    aiRequests: [],
    aiFail: false,
    requestLog: [],
  };
  if (opts.seed !== false) state.gmail.seedDefault(DEFAULT_IDENTITY.email, DEFAULT_IDENTITY.name);

  let baseUrl = "";

  async function idToken(identity: FakeIdentity, nonce: string): Promise<string> {
    return new SignJWT({
      email: identity.email,
      email_verified: identity.emailVerified ?? true,
      name: identity.name,
      picture: identity.picture,
      nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .setIssuer(baseUrl)
      .setAudience(state.clientId)
      .setSubject(identity.sub)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  }

  function issueAccess(email: string): string {
    const t = `ya29.fake-${randomBytes(12).toString("hex")}`;
    state.accessTokens.set(t, { email, exp: Date.now() + 3600_000 });
    return t;
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", baseUrl);
      const path = url.pathname;
      state.requestLog.push({ method: req.method ?? "GET", path });

      // --- Test control ---
      if (path === "/__control/identity" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as FakeIdentity & { scopes?: string | null };
        state.nextIdentity = body;
        state.grantedScopes = body.scopes ?? null;
        if (!state.gmail.has(body.email)) state.gmail.seedDefault(body.email, body.name);
        return send(res, 200, { ok: true });
      }
      if (path === "/__control/reset" && req.method === "POST") {
        state.nextIdentity = DEFAULT_IDENTITY;
        state.grantedScopes = null;
        state.failRefresh = false;
        state.aiFail = false;
        return send(res, 200, { ok: true });
      }

      // --- OAuth / OIDC ---
      if (path === "/o/oauth2/v2/auth") {
        const p = url.searchParams;
        if (p.get("client_id") !== state.clientId) return send(res, 400, "<h1>invalid_client</h1>");
        if (p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) return send(res, 400, "<h1>PKCE required</h1>");
        const redirect = new URL(p.get("redirect_uri") ?? "");
        if (url.searchParams.get("deny") === "1") {
          redirect.searchParams.set("error", "access_denied");
          redirect.searchParams.set("state", p.get("state") ?? "");
          res.writeHead(302, { location: redirect.toString() });
          return res.end();
        }
        const code = `fake-code-${randomBytes(10).toString("hex")}`;
        state.codes.set(code, {
          challenge: p.get("code_challenge")!,
          nonce: p.get("nonce") ?? "",
          redirectUri: p.get("redirect_uri") ?? "",
          identity: state.nextIdentity,
          scope: state.grantedScopes ?? (p.get("scope") ?? ""),
        });
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", p.get("state") ?? "");
        res.writeHead(302, { location: redirect.toString() });
        return res.end();
      }
      if (path === "/token" && req.method === "POST") {
        const p = new URLSearchParams(await readBody(req));
        if (p.get("client_id") !== state.clientId || p.get("client_secret") !== state.clientSecret) return send(res, 401, { error: "invalid_client" });
        if (p.get("grant_type") === "authorization_code") {
          const entry = state.codes.get(p.get("code") ?? "");
          state.codes.delete(p.get("code") ?? "");
          if (!entry) return send(res, 400, { error: "invalid_grant" });
          const challenge = createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url");
          if (challenge !== entry.challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
          if (p.get("redirect_uri") !== entry.redirectUri) return send(res, 400, { error: "redirect_uri_mismatch" });
          const refresh = `1//fake-refresh-${randomBytes(12).toString("hex")}`;
          state.refreshTokens.set(refresh, entry.identity.email);
          return send(res, 200, {
            access_token: issueAccess(entry.identity.email),
            expires_in: 3599,
            refresh_token: refresh,
            scope: entry.scope,
            token_type: "Bearer",
            id_token: await idToken(entry.identity, entry.nonce),
          });
        }
        if (p.get("grant_type") === "refresh_token") {
          const email = state.refreshTokens.get(p.get("refresh_token") ?? "");
          if (!email || state.failRefresh) return send(res, 400, { error: "invalid_grant" });
          return send(res, 200, { access_token: issueAccess(email), expires_in: 3599, token_type: "Bearer" });
        }
        return send(res, 400, { error: "unsupported_grant_type" });
      }
      if (path === "/revoke" && req.method === "POST") {
        const p = new URLSearchParams(await readBody(req));
        const t = p.get("token") ?? "";
        state.revoked.push(t);
        state.refreshTokens.delete(t);
        state.accessTokens.delete(t);
        return send(res, 200, {});
      }
      if (path === "/oauth2/v3/certs") return send(res, 200, { keys: [jwk] });

      // --- xAI Responses API ---
      if (path === "/v1/responses" && req.method === "POST") {
        if (req.headers.authorization !== "Bearer fake-xai-key") return send(res, 401, { error: { message: "bad key" } });
        if (state.aiFail) return send(res, 500, { error: { message: "upstream failure" } });
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const { task, payload } = fakeAiRespond(body);
        state.aiRequests.push({ task, input: JSON.stringify(body.input ?? "") });
        return send(res, 200, payload);
      }

      // --- Gmail ---
      if (path.startsWith("/gmail/v1/users/me")) {
        const auth = req.headers.authorization ?? "";
        const tok = state.accessTokens.get(auth.replace(/^Bearer /, ""));
        if (!tok || tok.exp < Date.now()) return send(res, 401, { error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } });
        const body = req.method === "GET" || req.method === "DELETE" ? undefined : await readBody(req);
        const r = state.gmail.handle(tok.email, req.method ?? "GET", path.slice("/gmail/v1/users/me".length), url.searchParams, body);
        if (r.status === 204) {
          res.writeHead(204);
          return res.end();
        }
        return send(res, r.status, r.body);
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      send(res, 500, { error: String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return {
    url: baseUrl,
    state,
    mailbox: (email: string) => state.gmail.mailbox(email),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
