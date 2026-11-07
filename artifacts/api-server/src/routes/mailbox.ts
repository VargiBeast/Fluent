import { Router, type Request } from "express";
import {
  aiDraftBodySchema,
  approvalBodySchema,
  consumeApprovalSchema,
  draftBodySchema,
  labelBodySchema,
  preferencesSchema,
  searchBodySchema,
} from "@workspace/api-zod";
import { loadConfig } from "../config";
import { HttpError } from "../errors";
import { clearOAuthCookie, readCookie, setOAuthCookie } from "../http/cookies";
import { requestFetch } from "../http/security";
import { sha256, safeEqualHex } from "../crypto/secrets";
import { consumeOAuthState } from "../services/auth";
import { exchangeAuthCode, fetchUserInfo } from "../gmail/client";
import { assertSafeGmailQuery, interpretWithRules } from "../ai/interpret";
import { liveInterpret } from "../ai/live";
import { mockDraft, mockOverview, mockSummarize } from "../ai/mock";
import { liveDraft, liveOverview, liveSummarize } from "../ai/live";
import {
  applyApprovedAction,
  approveAction,
  disconnectGmail,
  getPreferences,
  getThread,
  gmailStatus,
  listDrafts,
  listThreads,
  saveDraft,
  saveGmailConnection,
  setFlags,
  syncMailbox,
  updatePreferences,
} from "../services/mailbox";
import { startOAuth } from "../services/auth";

const router = Router();

function requireUser(req: Request) {
  if (req.authFailure === "expired") throw new HttpError(401, "SESSION_EXPIRED", "The session expired. Sign in again.");
  if (req.authFailure === "revoked") throw new HttpError(401, "SESSION_REVOKED", "This session was signed out.");
  if (!req.fluent) throw new HttpError(401, "UNAUTHORIZED", "Sign in to continue");
  const header = req.get("x-fluent-csrf") ?? "";
  const cookie = readCookie(req.cookies ?? {}, "csrf") ?? "";
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (!header || header !== cookie || !safeEqualHex(sha256(header), req.fluent.csrfHash)) {
      throw new HttpError(403, "CSRF", "The security token did not match this session");
    }
  }
  return req.fluent;
}

router.get("/gmail/status", async (req, res) => {
  const user = requireUser(req);
  res.json(await gmailStatus(user.userId, loadConfig()));
});

router.get("/gmail/connect/start", async (req, res) => {
  const user = requireUser(req);
  const config = loadConfig();
  const started = await startOAuth({
    config,
    purpose: "gmail",
    userId: user.userId,
    returnTo: "/settings",
  });
  setOAuthCookie(res, config, started.state);
  res.redirect(started.url);
});

router.get("/gmail/connect/callback", async (req, res) => {
  const config = loadConfig();
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!state || !code) throw new HttpError(400, "OAUTH_STATE", "Google did not return a complete connection response");
  if (!req.fluent) throw new HttpError(401, "UNAUTHORIZED", "Sign in before connecting Gmail");
  const consumed = await consumeOAuthState({
    config,
    purpose: "gmail",
    state,
    cookieState: readCookie(req.cookies ?? {}, "oauth"),
  });
  clearOAuthCookie(res, config);
  if (!consumed.userId) throw new HttpError(400, "OAUTH_STATE", "Gmail connection was not tied to a signed-in user");
  if (!req.fluent || req.fluent.userId !== consumed.userId) {
    throw new HttpError(403, "FORBIDDEN", "Sign in with the same FLUENT account before connecting Gmail");
  }
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new HttpError(503, "BLOCKED", "Google OAuth is not configured");
  }
  const tokens = await exchangeAuthCode({
    fetchImpl: requestFetch(req),
    code,
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.gmailRedirectUri,
    codeVerifier: consumed.verifier,
  });
  const profile = await fetchUserInfo(requestFetch(req), tokens.accessToken);
  await saveGmailConnection({
    userId: req.fluent.userId,
    config,
    email: profile.email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    scope: tokens.scope,
  });
  res.redirect(`${config.appOrigin}/settings?gmail=connected`);
});

router.post("/gmail/disconnect", async (req, res) => {
  const user = requireUser(req);
  const result = await disconnectGmail(user.userId, loadConfig(), requestFetch(req));
  res.json({ disconnected: true, revoked: result.revoked, sendEnabled: false });
});

router.post("/gmail/sync", async (req, res) => {
  const user = requireUser(req);
  const result = await syncMailbox({
    userId: user.userId,
    userEmail: user.email,
    isDemo: user.isDemo,
    config: loadConfig(),
    fetchImpl: requestFetch(req),
  });
  res.json({ ...result, exhaustive: false });
});

router.get("/threads", async (req, res) => {
  const user = requireUser(req);
  const view = typeof req.query.view === "string" ? req.query.view : "inbox";
  const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
  const query = typeof req.query.q === "string" ? assertSafeGmailQuery(req.query.q) : undefined;
  const result = await listThreads({
    userId: user.userId,
    userEmail: user.email,
    isDemo: user.isDemo,
    config: loadConfig(),
    fetchImpl: requestFetch(req),
    view,
    pageToken,
    query,
  });
  res.json(result);
});

router.get("/threads/:threadId", async (req, res) => {
  const user = requireUser(req);
  const prefs = await getPreferences(user.userId);
  const thread = await getThread({
    userId: user.userId,
    userEmail: user.email,
    isDemo: user.isDemo,
    threadId: req.params.threadId,
    config: loadConfig(),
    fetchImpl: requestFetch(req),
    allowRemoteImages: prefs.loadRemoteImages,
  });
  res.json(thread);
});

router.post("/threads/:threadId/flags", async (req, res) => {
  const user = requireUser(req);
  const body = labelBodySchema.parse(req.body ?? {});
  await setFlags({
    userId: user.userId,
    threadId: req.params.threadId,
    config: loadConfig(),
    fetchImpl: requestFetch(req),
    unread: body.unread,
    starred: body.starred,
  });
  res.json({ updated: true });
});

router.post("/approvals", async (req, res) => {
  const user = requireUser(req);
  const body = approvalBodySchema.parse(req.body ?? {});
  res.json(await approveAction(user.userId, body.threadId, body.action));
});

router.post("/threads/:threadId/archive", async (req, res) => {
  const user = requireUser(req);
  const body = consumeApprovalSchema.parse(req.body ?? {});
  await applyApprovedAction({
    userId: user.userId,
    threadId: req.params.threadId,
    approvalId: body.approvalId,
    action: "archive",
    config: loadConfig(),
    fetchImpl: requestFetch(req),
  });
  res.json({ archived: true, permanent: false });
});

router.post("/threads/:threadId/trash", async (req, res) => {
  const user = requireUser(req);
  const body = consumeApprovalSchema.parse(req.body ?? {});
  await applyApprovedAction({
    userId: user.userId,
    threadId: req.params.threadId,
    approvalId: body.approvalId,
    action: "trash",
    config: loadConfig(),
    fetchImpl: requestFetch(req),
  });
  res.json({ trashed: true, permanent: false });
});

router.post("/search", async (req, res) => {
  const user = requireUser(req);
  const body = searchBodySchema.parse(req.body ?? {});
  const config = loadConfig();
  let interpretation = interpretWithRules(body.query);
  if (config.aiMode === "live") {
    try {
      interpretation = await liveInterpret(config, body.query, requestFetch(req));
    } catch {
      interpretation = {
        ...interpretWithRules(body.query),
        explanation: "The model request failed, so FLUENT used the rules interpreter. Results are not exhaustive.",
      };
    }
  }
  const result = interpretation.gmailQuery
    ? await listThreads({
        userId: user.userId,
        userEmail: user.email,
        isDemo: user.isDemo,
        config,
        fetchImpl: requestFetch(req),
        view: "all",
        pageToken: body.pageToken,
        query: interpretation.gmailQuery,
      })
    : { threads: [], nextPageToken: null, source: user.isDemo ? "demo" : "none", exhaustive: false as const };
  res.json({ interpretation: { ...interpretation, exhaustive: false }, ...result, exhaustive: false });
});

router.post("/ai/threads/:threadId/summary", async (req, res) => {
  const user = requireUser(req);
  const config = loadConfig();
  if (config.aiMode === "blocked") {
    throw new HttpError(503, "BLOCKED", "AI is not configured. Set AI_API_KEY or AI_PROVIDER=mock.", ["AI_API_KEY"]);
  }
  const prefs = await getPreferences(user.userId);
  const thread = await getThread({
    userId: user.userId,
    userEmail: user.email,
    isDemo: user.isDemo,
    threadId: req.params.threadId,
    config,
    fetchImpl: requestFetch(req),
    allowRemoteImages: prefs.loadRemoteImages,
  });
  const messages = thread.messages.map((message) => ({
    id: message.id,
    from: message.fromEmail,
    subject: message.subject,
    body: message.bodyText,
  }));
  const summary =
    config.aiMode === "mock"
      ? mockSummarize(messages)
      : await liveSummarize(config, messages, requestFetch(req));
  res.json({ ...summary, syntheticMailbox: thread.synthetic });
});

router.post("/ai/drafts", async (req, res) => {
  const user = requireUser(req);
  const config = loadConfig();
  const body = aiDraftBodySchema.parse(req.body ?? {});
  if (config.aiMode === "blocked") {
    throw new HttpError(503, "BLOCKED", "AI is not configured. Set AI_API_KEY or AI_PROVIDER=mock.", ["AI_API_KEY"]);
  }
  const thread = await getThread({
    userId: user.userId,
    userEmail: user.email,
    isDemo: user.isDemo,
    threadId: body.threadId,
    config,
    fetchImpl: requestFetch(req),
    allowRemoteImages: false,
  });
  const messages = thread.messages.map((message) => ({
    id: message.id,
    from: message.fromEmail,
    subject: message.subject,
    body: message.bodyText,
  }));
  const draft =
    config.aiMode === "mock"
      ? mockDraft({ messages, instruction: body.instruction, currentDraft: body.draft ?? "" })
      : await liveDraft(config, { messages, instruction: body.instruction, currentDraft: body.draft ?? "" }, requestFetch(req));
  res.json({ ...draft, sent: false });
});

router.post("/ai/overview", async (req, res) => {
  const user = requireUser(req);
  const config = loadConfig();
  if (config.aiMode === "blocked") {
    throw new HttpError(503, "BLOCKED", "AI is not configured. Set AI_API_KEY or AI_PROVIDER=mock.", ["AI_API_KEY"]);
  }
  const listed = await listThreads({
    userId: user.userId,
    userEmail: user.email,
    isDemo: user.isDemo,
    config,
    fetchImpl: requestFetch(req),
    view: "all",
  });
  const grounded = listed.threads.map((thread) => ({
    id: thread.id,
    subject: thread.subject,
    snippet: thread.snippet,
    needsReply: thread.needsReply,
    isImportant: thread.isImportant,
    isUnread: thread.isUnread,
  }));
  const overview = config.aiMode === "mock" ? mockOverview(grounded) : await liveOverview(config, grounded, requestFetch(req));
  res.json({ ...overview, exhaustive: false, source: listed.source });
});

router.get("/drafts", async (req, res) => {
  const user = requireUser(req);
  res.json({ drafts: await listDrafts(user.userId), sent: false });
});

router.post("/drafts", async (req, res) => {
  const user = requireUser(req);
  const body = draftBodySchema.parse(req.body ?? {});
  res.status(201).json(
    await saveDraft({
      userId: user.userId,
      threadId: body.threadId,
      kind: body.kind,
      toEmail: body.toEmail,
      subject: body.subject,
      body: body.body,
    }),
  );
});

router.get("/preferences", async (req, res) => {
  const user = requireUser(req);
  const prefs = await getPreferences(user.userId);
  res.json({ ...prefs, onboarded: user.onboarded });
});

router.put("/preferences", async (req, res) => {
  const user = requireUser(req);
  const body = preferencesSchema.parse(req.body ?? {});
  const prefs = await updatePreferences(user.userId, body);
  res.json({ ...prefs, onboarded: body.onboarded ?? user.onboarded });
});

export default router;
