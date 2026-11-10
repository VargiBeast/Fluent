import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

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
  };
  close(): Promise<void>;
}

export async function startFakeMicrosoft(): Promise<FakeMicrosoft> {
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();
  const state: FakeMicrosoft["state"] = {
    clientId: "ms-client-id", clientSecret: "ms-client-secret", grantScope: "Mail.ReadWrite Mail.Send User.Read offline_access", issueRefreshToken: true,
    profile: { id: "00000000-0000-0000-0000-00000000a1ce", displayName: "Alex Outlook", mail: "alex@outlook.example", userPrincipalName: "alex@outlook.example" },
    lastAuthorize: null, tokens: new Map(),
  };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
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
        if (p.get("grant_type") === "authorization_code") {
          const c = codes.get(p.get("code") ?? "");
          codes.delete(p.get("code") ?? "");
          const verifier = p.get("code_verifier") ?? "";
          const challenge = createHash("sha256").update(verifier).digest("base64url");
          if (!c || c.challenge !== challenge || c.redirectUri !== p.get("redirect_uri") || c.clientId !== state.clientId) return json(400, { error: "invalid_grant" });
        } else if (p.get("grant_type") !== "refresh_token") return json(400, { error: "unsupported_grant_type" });
        const access = randomBytes(16).toString("hex");
        state.tokens.set(access, state.profile.id);
        return json(200, { token_type: "Bearer", expires_in: 3600, scope: state.grantScope, access_token: access, ...(state.issueRefreshToken ? { refresh_token: `rt-${randomBytes(8).toString("hex")}` } : {}) });
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/graph/v1.0/me") {
      const tok = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!state.tokens.has(tok)) return json(401, { error: { code: "InvalidAuthenticationToken" } });
      return json(200, state.profile);
    }
    json(404, { error: "not_found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state, close: () => new Promise((r) => server.close(() => r())) };
}
