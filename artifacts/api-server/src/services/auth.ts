import { and, eq, isNull } from "drizzle-orm";
import { oauthStates, profiles, sessions, userPreferences, type DbTransaction } from "@workspace/db";
import { withOwner, withUser } from "@workspace/db";
import type { AppConfig } from "../config";
import { assertSafeReturnTo } from "../config";
import { encryptString, decryptString, pkceChallenge, randomToken, sha256 } from "../crypto/secrets";
import { HttpError, blocked } from "../errors";
import {
  exchangeAuthCode,
  fetchUserInfo,
  googleAuthorizeUrl,
  type FetchLike,
} from "../gmail/client";
import { GMAIL_CONNECT_SCOPES, LOGIN_SCOPES } from "../gmail/scopes";
import { setupStatus } from "../config";

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  isDemo: boolean;
  onboarded: boolean;
}

export async function createSession(
  userId: string,
  userAgent: string | undefined,
): Promise<{ token: string; csrf: string; sessionId: string }> {
  const token = randomToken();
  const csrf = randomToken();
  const sessionId = await withUser(userId, async (tx) => {
    const [row] = await tx
      .insert(sessions)
      .values({
        userId,
        tokenHash: sha256(token),
        csrfHash: sha256(csrf),
        expiresAt: new Date(Date.now() + SESSION_MS),
        userAgent: userAgent?.slice(0, 200) ?? null,
      })
      .returning({ id: sessions.id });
    return row?.id;
  });
  if (!sessionId) throw new HttpError(500, "INTERNAL", "Could not start a session");
  return { token, csrf, sessionId };
}

export async function readSession(token: string): Promise<
  | { status: "ok"; user: PublicUser; sessionId: string; csrfHash: string }
  | { status: "missing" }
  | { status: "expired" | "revoked" }
> {
  const tokenHash = sha256(token);
  const found = await withOwner(async (tx) => {
    const [row] = await tx
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        csrfHash: sessions.csrfHash,
        userId: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        isDemo: profiles.isDemo,
        onboarded: profiles.onboarded,
      })
      .from(sessions)
      .innerJoin(profiles, eq(profiles.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  });
  if (!found) return { status: "missing" };
  if (found.revokedAt) return { status: "revoked" };
  if (found.expiresAt.getTime() <= Date.now()) return { status: "expired" };
  return {
    status: "ok",
    sessionId: found.sessionId,
    csrfHash: found.csrfHash,
    user: {
      id: found.userId,
      email: found.email,
      displayName: found.displayName,
      isDemo: found.isDemo,
      onboarded: found.onboarded,
    },
  };
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await withUser(userId, async (tx) => {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  });
}

export async function startOAuth(input: {
  config: AppConfig;
  purpose: "login" | "gmail";
  userId?: string;
  returnTo?: string;
}): Promise<{ url: string; state: string }> {
  const status = setupStatus(input.config);
  if (status.googleLogin === "blocked" || !input.config.googleClientId || !input.config.tokenEncryptionKey) {
    throw blocked(
      status.missing.filter((name) => name !== "AI_API_KEY"),
      "Google sign-in is not configured",
    );
  }
  const state = randomToken();
  const verifier = randomToken();
  const returnTo = assertSafeReturnTo(input.returnTo);
  await withOwner(async (tx) => {
    await tx.insert(oauthStates).values({
      purpose: input.purpose,
      stateHash: sha256(state),
      verifierCiphertext: encryptString(verifier, input.config.tokenEncryptionKey!),
      userId: input.userId ?? null,
      returnTo,
      expiresAt: new Date(Date.now() + STATE_MS),
    });
  });
  const url = googleAuthorizeUrl({
    clientId: input.config.googleClientId,
    redirectUri: input.purpose === "login" ? input.config.loginRedirectUri : input.config.gmailRedirectUri,
    scopes: input.purpose === "login" ? LOGIN_SCOPES : GMAIL_CONNECT_SCOPES,
    state,
    codeChallenge: pkceChallenge(verifier),
    prompt: input.purpose === "gmail" ? "consent" : "select_account",
  });
  return { url, state };
}

export async function consumeOAuthState(input: {
  config: AppConfig;
  purpose: "login" | "gmail";
  state: string;
  cookieState: string | undefined;
}): Promise<{ verifier: string; userId: string | null; returnTo: string }> {
  if (!input.cookieState || input.cookieState !== input.state) {
    throw new HttpError(400, "OAUTH_STATE", "The sign-in attempt did not match this browser");
  }
  if (!input.config.tokenEncryptionKey) {
    throw blocked(["TOKEN_ENCRYPTION_KEY"], "Token encryption is not configured");
  }
  const key = input.config.tokenEncryptionKey;
  const consumed = await withOwner(async (tx) => {
    const [row] = await tx
      .update(oauthStates)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oauthStates.stateHash, sha256(input.state)),
          eq(oauthStates.purpose, input.purpose),
          isNull(oauthStates.consumedAt),
        ),
      )
      .returning();
    return row ?? null;
  });
  if (!consumed || consumed.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, "OAUTH_STATE", "This sign-in attempt expired or was already used");
  }
  return {
    verifier: decryptString(consumed.verifierCiphertext, key),
    userId: consumed.userId,
    returnTo: consumed.returnTo,
  };
}

export async function loginWithGoogleCode(input: {
  config: AppConfig;
  code: string;
  verifier: string;
  fetchImpl: FetchLike;
  userAgent?: string;
}): Promise<{ user: PublicUser; token: string; csrf: string; returnTo: string }> {
  if (!input.config.googleClientId || !input.config.googleClientSecret) {
    throw blocked(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], "Google sign-in is not configured");
  }
  const tokens = await exchangeAuthCode({
    fetchImpl: input.fetchImpl,
    code: input.code,
    clientId: input.config.googleClientId,
    clientSecret: input.config.googleClientSecret,
    redirectUri: input.config.loginRedirectUri,
    codeVerifier: input.verifier,
  });
  const profile = await fetchUserInfo(input.fetchImpl, tokens.accessToken);
  if (!profile.emailVerified) {
    throw new HttpError(403, "EMAIL_UNVERIFIED", "Google did not mark this email as verified");
  }
  const user = await upsertGoogleProfile(profile);
  const session = await createSession(user.id, input.userAgent);
  return { user, token: session.token, csrf: session.csrf, returnTo: "/onboarding" };
}

export async function upsertGoogleProfile(profile: {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}): Promise<PublicUser> {
  return withOwner(async (tx) => {
    const [existing] = await tx
      .select()
      .from(profiles)
      .where(eq(profiles.googleSub, profile.sub))
      .limit(1);
    if (existing) {
      const [updated] = await tx
        .update(profiles)
        .set({
          email: profile.email,
          displayName: profile.name,
          avatarUrl: profile.picture,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, existing.id))
        .returning();
      return toPublic(updated ?? existing);
    }
    const [byEmail] = await tx.select().from(profiles).where(eq(profiles.email, profile.email)).limit(1);
    if (byEmail?.isDemo) {
      throw new HttpError(409, "DEMO_ACCOUNT", "The demo account cannot be linked to Google");
    }
    if (byEmail) {
      const [updated] = await tx
        .update(profiles)
        .set({ googleSub: profile.sub, displayName: profile.name, avatarUrl: profile.picture, updatedAt: new Date() })
        .where(eq(profiles.id, byEmail.id))
        .returning();
      return toPublic(updated ?? byEmail);
    }
    const [created] = await tx
      .insert(profiles)
      .values({
        email: profile.email,
        googleSub: profile.sub,
        displayName: profile.name,
        avatarUrl: profile.picture,
        isDemo: false,
      })
      .returning();
    if (!created) throw new HttpError(500, "INTERNAL", "Could not create the account");
    await ensurePreferences(tx, created.id);
    return toPublic(created);
  });
}

export async function startDemoSession(userAgent: string | undefined): Promise<{
  user: PublicUser;
  token: string;
  csrf: string;
}> {
  const user = await withOwner(async (tx) => {
    const email = "demo@fluent.invalid";
    const [existing] = await tx.select().from(profiles).where(eq(profiles.email, email)).limit(1);
    if (existing) return toPublic(existing);
    const [created] = await tx
      .insert(profiles)
      .values({
        email,
        displayName: "Demo User",
        isDemo: true,
        onboarded: false,
      })
      .returning();
    if (!created) throw new HttpError(500, "INTERNAL", "Could not create the demo account");
    await ensurePreferences(tx, created.id);
    return toPublic(created);
  });
  const session = await createSession(user.id, userAgent);
  return { user, token: session.token, csrf: session.csrf };
}

async function ensurePreferences(tx: DbTransaction, userId: string): Promise<void> {
  await tx.insert(userPreferences).values({ userId }).onConflictDoNothing();
}

function toPublic(row: {
  id: string;
  email: string;
  displayName: string | null;
  isDemo: boolean;
  onboarded: boolean;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    isDemo: row.isDemo,
    onboarded: row.onboarded,
  };
}
