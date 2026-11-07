import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  actionApprovals,
  auditEvents,
  connectedAccounts,
  emailAttachments,
  emailSyncState,
  emailThreads,
  emails,
  localDrafts,
  profiles,
  userPreferences,
  withUser,
} from "@workspace/db";
import type { AppConfig } from "../config";
import { blocked, HttpError } from "../errors";
import { decryptString, encryptString } from "../crypto/secrets";
import { sanitizeEmailHtml } from "../html/sanitize";
import { buildDemoThreads } from "../gmail/demo-data";
import {
  createGmailClient,
  refreshAccessToken,
  revokeToken,
  type FetchLike,
  type GmailClient,
} from "../gmail/client";
import { GmailHttpError } from "../gmail/client";
import {
  categoryFromLabels,
  needsReply,
  parseGmailMessage,
  type GmailThreadResource,
} from "../gmail/parse";
import { GMAIL_MODIFY_SCOPE } from "../gmail/scopes";

export interface ThreadSummary {
  id: string;
  source: "gmail" | "demo";
  subject: string;
  snippet: string;
  lastMessageAt: string;
  fromName: string | null;
  fromEmail: string;
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  needsReply: boolean;
  hasAttachments: boolean;
  labels: string[];
  category: string | null;
  messageCount: number;
}

export async function gmailStatus(userId: string, config: AppConfig) {
  const account = await loadAccount(userId);
  return {
    connected: account?.status === "active",
    status: account?.status ?? "disconnected",
    email: account?.email ?? null,
    scopes: account?.scopes ?? [],
    scopeIncludesSend: account?.scopes.includes(GMAIL_MODIFY_SCOPE) ?? false,
    applicationSendEnabled: false,
    encryption: config.tokenEncryptionKey ? "ready" : "blocked",
    demoFallback: false,
  };
}

export async function saveGmailConnection(input: {
  userId: string;
  config: AppConfig;
  email: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}): Promise<void> {
  if (!input.config.tokenEncryptionKey) {
    throw blocked(["TOKEN_ENCRYPTION_KEY"], "Token encryption is not configured");
  }
  if (!input.refreshToken) {
    throw new HttpError(400, "REAUTH_REQUIRED", "Google did not return a refresh token. Connect again and grant offline access.");
  }
  const key = input.config.tokenEncryptionKey;
  const scopes = input.scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes(GMAIL_MODIFY_SCOPE)) {
    throw new HttpError(400, "SCOPE", "Gmail connection did not include the mailbox scope");
  }
  await withUser(input.userId, async (tx) => {
    await tx
      .insert(connectedAccounts)
      .values({
        userId: input.userId,
        provider: "gmail",
        email: input.email,
        scopes,
        accessTokenCiphertext: encryptString(input.accessToken, key),
        refreshTokenCiphertext: encryptString(input.refreshToken!, key),
        tokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
        status: "active",
        connectedAt: new Date(),
        disconnectedAt: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [connectedAccounts.userId, connectedAccounts.provider],
        set: {
          email: input.email,
          scopes,
          accessTokenCiphertext: encryptString(input.accessToken, key),
          refreshTokenCiphertext: encryptString(input.refreshToken!, key),
          tokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
          status: "active",
          connectedAt: new Date(),
          disconnectedAt: null,
          updatedAt: new Date(),
        },
      });
    await tx.insert(auditEvents).values({
      userId: input.userId,
      action: "gmail_connect",
      result: "ok",
    });
  });
}

export async function disconnectGmail(userId: string, config: AppConfig, fetchImpl: FetchLike): Promise<{ revoked: boolean }> {
  const account = await loadAccount(userId);
  let revoked = false;
  if (account?.refreshTokenCiphertext && config.tokenEncryptionKey) {
    try {
      const token = decryptString(account.refreshTokenCiphertext, config.tokenEncryptionKey);
      revoked = await revokeToken(fetchImpl, token);
    } catch {
      revoked = false;
    }
  }
  await withUser(userId, async (tx) => {
    await tx
      .update(connectedAccounts)
      .set({
        accessTokenCiphertext: null,
        refreshTokenCiphertext: null,
        status: "disconnected",
        disconnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, "gmail")));
    await tx.insert(auditEvents).values({
      userId,
      action: "gmail_disconnect",
      result: revoked ? "revoked" : "cleared_locally",
    });
  });
  return { revoked };
}

export async function listThreads(input: {
  userId: string;
  userEmail: string;
  isDemo: boolean;
  config: AppConfig;
  fetchImpl: FetchLike;
  view: string;
  pageToken?: string;
  query?: string;
}): Promise<{ threads: ThreadSummary[]; nextPageToken: string | null; source: "gmail" | "demo" | "none"; exhaustive: false }> {
  const mode = await mailboxMode(input);
  if (mode === "demo") {
    await seedDemo(input.userId, input.userEmail);
    const threads = await readLocalThreads(input.userId, input.view, input.query);
    const offset = input.pageToken?.startsWith("demo:") ? Number(input.pageToken.slice(5)) : 0;
    const page = threads.slice(offset, offset + 20);
    const next = offset + 20 < threads.length ? `demo:${offset + 20}` : null;
    return { threads: page, nextPageToken: next, source: "demo", exhaustive: false };
  }
  if (mode === "gmail") {
    const client = await gmailClientFor(input.userId, input.config, input.fetchImpl);
    const labelIds = viewToLabels(input.view);
    const listed = await client.listThreads({
      pageToken: input.pageToken,
      query: input.query,
      labelIds,
      maxResults: 20,
    });
    for (const threadId of listed.threadIds) {
      const resource = await client.getThread(threadId, "metadata");
      await storeGmailThread(input.userId, input.userEmail, resource, false);
    }
    const threads = await readLocalThreads(input.userId, input.view, undefined, listed.threadIds);
    await touchSync(input.userId, "gmail", "ok");
    return {
      threads,
      nextPageToken: listed.nextPageToken ?? null,
      source: "gmail",
      exhaustive: false,
    };
  }
  return { threads: [], nextPageToken: null, source: "none", exhaustive: false };
}

export async function getThread(input: {
  userId: string;
  userEmail: string;
  isDemo: boolean;
  threadId: string;
  config: AppConfig;
  fetchImpl: FetchLike;
  allowRemoteImages: boolean;
}) {
  const [local] = await withUser(input.userId, async (tx) =>
    tx.select().from(emailThreads).where(eq(emailThreads.id, input.threadId)).limit(1),
  );
  if (!local) throw new HttpError(404, "NOT_FOUND", "Conversation not found");
  if (local.source === "gmail") {
    const messages = await withUser(input.userId, async (tx) =>
      tx.select().from(emails).where(eq(emails.threadId, local.id)),
    );
    const missingBody = messages.some((message) => !message.bodyText && !message.bodyHtmlSanitized);
    if (missingBody || messages.length === 0) {
      const client = await gmailClientFor(input.userId, input.config, input.fetchImpl);
      const full = await client.getThread(local.externalId, "full");
      await storeGmailThread(input.userId, input.userEmail, full, true, input.allowRemoteImages);
    }
  }
  return loadThreadDetail(input.userId, input.threadId);
}

export async function syncMailbox(input: {
  userId: string;
  userEmail: string;
  isDemo: boolean;
  config: AppConfig;
  fetchImpl: FetchLike;
}): Promise<{ source: "gmail" | "demo" | "none"; imported: number }> {
  const mode = await mailboxMode(input);
  if (mode === "demo") {
    const imported = await seedDemo(input.userId, input.userEmail);
    await touchSync(input.userId, "demo", "ok");
    return { source: "demo", imported };
  }
  if (mode === "gmail") {
    const result = await listThreads({ ...input, view: "inbox" });
    return { source: "gmail", imported: result.threads.length };
  }
  throw blocked(
    input.config.tokenEncryptionKey ? ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] : ["TOKEN_ENCRYPTION_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    "Connect Gmail before syncing. Demo mail is only available in an explicit demo session.",
  );
}

export async function setFlags(input: {
  userId: string;
  threadId: string;
  config: AppConfig;
  fetchImpl: FetchLike;
  unread?: boolean;
  starred?: boolean;
}): Promise<void> {
  const detail = await requireThread(input.userId, input.threadId);
  const labels = new Set(detail.labels);
  if (input.unread === true) labels.add("UNREAD");
  if (input.unread === false) labels.delete("UNREAD");
  if (input.starred === true) labels.add("STARRED");
  if (input.starred === false) labels.delete("STARRED");
  if (detail.source === "gmail") {
    const client = await gmailClientFor(input.userId, input.config, input.fetchImpl);
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];
    if (input.unread === true) addLabelIds.push("UNREAD");
    if (input.unread === false) removeLabelIds.push("UNREAD");
    if (input.starred === true) addLabelIds.push("STARRED");
    if (input.starred === false) removeLabelIds.push("STARRED");
    await client.modifyThread(detail.externalId, { addLabelIds, removeLabelIds });
  }
  await withUser(input.userId, async (tx) => {
    await tx
      .update(emailThreads)
      .set({
        labels: Array.from(labels),
        isUnread: labels.has("UNREAD"),
        isStarred: labels.has("STARRED"),
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, input.threadId));
    if (input.unread != null) {
      await tx.update(emails).set({ isUnread: input.unread }).where(eq(emails.threadId, input.threadId));
    }
  });
}

export async function approveAction(userId: string, threadId: string, action: "archive" | "trash") {
  await requireThread(userId, threadId);
  const [approval] = await withUser(userId, async (tx) =>
    tx
      .insert(actionApprovals)
      .values({
        userId,
        threadId,
        action,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      })
      .returning(),
  );
  if (!approval) throw new HttpError(500, "INTERNAL", "Could not record approval");
  return {
    approvalId: approval.id,
    action,
    threadId,
    expiresAt: approval.expiresAt.toISOString(),
  };
}

export async function applyApprovedAction(input: {
  userId: string;
  threadId: string;
  approvalId: string;
  action: "archive" | "trash";
  config: AppConfig;
  fetchImpl: FetchLike;
}): Promise<void> {
  const thread = await requireThread(input.userId, input.threadId);
  const [approval] = await withUser(input.userId, async (tx) =>
    tx
      .update(actionApprovals)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(actionApprovals.id, input.approvalId),
          eq(actionApprovals.userId, input.userId),
          eq(actionApprovals.threadId, input.threadId),
          eq(actionApprovals.action, input.action),
          isNull(actionApprovals.consumedAt),
          gt(actionApprovals.expiresAt, new Date()),
        ),
      )
      .returning(),
  );
  if (!approval) {
    throw new HttpError(403, "APPROVAL_REQUIRED", "This action needs a fresh confirmation for this conversation");
  }
  if (thread.source === "gmail") {
    const client = await gmailClientFor(input.userId, input.config, input.fetchImpl);
    if (input.action === "archive") {
      await client.modifyThread(thread.externalId, { removeLabelIds: ["INBOX"] });
    } else {
      await client.trashThread(thread.externalId);
    }
  }
  const labels = new Set(thread.labels);
  labels.delete("INBOX");
  if (input.action === "trash") labels.add("TRASH");
  await withUser(input.userId, async (tx) => {
    await tx
      .update(emailThreads)
      .set({ labels: Array.from(labels), updatedAt: new Date() })
      .where(eq(emailThreads.id, thread.id));
    await tx.insert(auditEvents).values({
      userId: input.userId,
      action: input.action,
      targetId: thread.id,
      result: "ok",
    });
  });
}

async function mailboxMode(input: {
  userId: string;
  isDemo: boolean;
  config: AppConfig;
}): Promise<"gmail" | "demo" | "none"> {
  const account = await loadAccount(input.userId);
  if (account?.status === "active" && input.config.tokenEncryptionKey && input.config.googleClientId) {
    return "gmail";
  }
  if (input.isDemo && input.config.demoMode) return "demo";
  return "none";
}

async function gmailClientFor(userId: string, config: AppConfig, fetchImpl: FetchLike): Promise<GmailClient> {
  const accessToken = await validAccessToken(userId, config, fetchImpl);
  return createGmailClient({ fetchImpl, accessToken });
}

async function validAccessToken(userId: string, config: AppConfig, fetchImpl: FetchLike): Promise<string> {
  if (!config.tokenEncryptionKey || !config.googleClientId || !config.googleClientSecret) {
    throw blocked(["TOKEN_ENCRYPTION_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], "Gmail is not configured");
  }
  const account = await loadAccount(userId);
  if (!account || account.status !== "active" || !account.accessTokenCiphertext || !account.refreshTokenCiphertext) {
    throw new HttpError(409, "GMAIL_DISCONNECTED", "Connect Gmail before reading this mailbox");
  }
  const key = config.tokenEncryptionKey;
  const fresh = account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() + 60_000;
  if (fresh) return decryptString(account.accessTokenCiphertext, key);
  try {
    const refreshed = await refreshAccessToken({
      fetchImpl,
      refreshToken: decryptString(account.refreshTokenCiphertext, key),
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    });
    const ciphertext = encryptString(refreshed.accessToken, key);
    await withUser(userId, async (tx) => {
      await tx
        .update(connectedAccounts)
        .set({
          accessTokenCiphertext: ciphertext,
          tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(connectedAccounts.id, account.id));
    });
    return refreshed.accessToken;
  } catch (error) {
    await withUser(userId, async (tx) => {
      await tx
        .update(connectedAccounts)
        .set({ status: "reauth_required", updatedAt: new Date() })
        .where(eq(connectedAccounts.id, account.id));
    });
    if (error instanceof GmailHttpError) throw error;
    throw new HttpError(401, "REAUTH_REQUIRED", "Gmail needs to be connected again");
  }
}

async function loadAccount(userId: string) {
  const [account] = await withUser(userId, async (tx) =>
    tx
      .select()
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, "gmail")))
      .limit(1),
  );
  return account ?? null;
}

async function seedDemo(userId: string, userEmail: string): Promise<number> {
  const threads = buildDemoThreads(userEmail);
  let imported = 0;
  await withUser(userId, async (tx) => {
    for (const thread of threads) {
      const [existing] = await tx
        .select({ id: emailThreads.id })
        .from(emailThreads)
        .where(and(eq(emailThreads.userId, userId), eq(emailThreads.externalId, thread.externalId)))
        .limit(1);
      if (existing) continue;
      const last = thread.messages[thread.messages.length - 1];
      const labels = thread.labels;
      const [created] = await tx
        .insert(emailThreads)
        .values({
          userId,
          source: "demo",
          externalId: thread.externalId,
          subject: thread.subject,
          snippet: last.bodyText.slice(0, 180),
          lastMessageAt: daysAgo(last.daysAgo),
          isUnread: labels.includes("UNREAD"),
          isStarred: labels.includes("STARRED"),
          isImportant: labels.includes("IMPORTANT"),
          needsReply: needsReply(last.fromEmail, userEmail, labels),
          labels,
          category: categoryFromLabels(labels),
          messageCount: thread.messages.length,
        })
        .returning();
      if (!created) continue;
      for (const message of thread.messages) {
        const html = sanitizeEmailHtml(`<p>${escapeHtml(message.bodyText)}</p>`, { allowRemoteImages: false });
        const [email] = await tx
          .insert(emails)
          .values({
            userId,
            threadId: created.id,
            externalId: message.externalId,
            fromName: message.fromName,
            fromEmail: message.fromEmail,
            toEmails: message.to,
            ccEmails: message.cc,
            subject: message.subject,
            snippet: message.bodyText.slice(0, 180),
            bodyText: message.bodyText,
            bodyHtmlSanitized: html,
            internalDate: daysAgo(message.daysAgo),
            isUnread: labels.includes("UNREAD"),
            isStarred: labels.includes("STARRED"),
            hasAttachments: message.attachments.length > 0,
            labels,
          })
          .returning();
        for (const attachment of message.attachments) {
          if (!email) continue;
          await tx.insert(emailAttachments).values({
            userId,
            emailId: email.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          });
        }
      }
      imported += 1;
    }
  });
  return imported;
}

async function storeGmailThread(
  userId: string,
  userEmail: string,
  resource: GmailThreadResource,
  replaceBodies: boolean,
  allowRemoteImages = false,
): Promise<void> {
  if (!resource.id) return;
  const parsed = (resource.messages ?? []).map(parseGmailMessage).filter((message) => message.externalId);
  if (parsed.length === 0) return;
  const last = parsed[parsed.length - 1];
  const labels = Array.from(new Set(parsed.flatMap((message) => message.labels)));
  await withUser(userId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(emailThreads)
      .where(and(eq(emailThreads.userId, userId), eq(emailThreads.externalId, resource.id!)))
      .limit(1);
    const values = {
      subject: last.subject || existing?.subject || "",
      snippet: last.snippet || existing?.snippet || "",
      lastMessageAt: last.internalDate,
      isUnread: labels.includes("UNREAD"),
      isStarred: labels.includes("STARRED"),
      isImportant: labels.includes("IMPORTANT"),
      needsReply: needsReply(last.from.email, userEmail, labels),
      labels,
      category: categoryFromLabels(labels),
      messageCount: parsed.length,
      updatedAt: new Date(),
    };
    const threadId = existing
      ? existing.id
      : (
          await tx
            .insert(emailThreads)
            .values({
              userId,
              source: "gmail",
              externalId: resource.id!,
              ...values,
            })
            .returning()
        )[0]?.id;
    if (!threadId) return;
    if (existing) {
      await tx.update(emailThreads).set(values).where(eq(emailThreads.id, threadId));
    }
    for (const message of parsed) {
      const html = message.bodyHtml
        ? sanitizeEmailHtml(message.bodyHtml, { allowRemoteImages })
        : message.bodyText
          ? sanitizeEmailHtml(`<p>${escapeHtml(message.bodyText)}</p>`, { allowRemoteImages: false })
          : "";
      const [current] = await tx
        .select()
        .from(emails)
        .where(and(eq(emails.userId, userId), eq(emails.externalId, message.externalId)))
        .limit(1);
      const bodyText = message.bodyText || (!replaceBodies ? current?.bodyText ?? "" : "");
      const bodyHtml = html || (!replaceBodies ? current?.bodyHtmlSanitized ?? "" : "");
      if (!current) {
        const [created] = await tx
          .insert(emails)
          .values({
            userId,
            threadId,
            externalId: message.externalId,
            fromName: message.from.name,
            fromEmail: message.from.email,
            toEmails: message.to,
            ccEmails: message.cc,
            subject: message.subject,
            snippet: message.snippet,
            bodyText,
            bodyHtmlSanitized: bodyHtml,
            internalDate: message.internalDate,
            isUnread: message.isUnread,
            isStarred: message.isStarred,
            hasAttachments: message.attachments.length > 0,
            labels: message.labels,
          })
          .returning();
        if (created) {
          for (const attachment of message.attachments) {
            await tx.insert(emailAttachments).values({
              userId,
              emailId: created.id,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              externalId: attachment.externalId,
            });
          }
        }
      } else if (replaceBodies || message.labels.length) {
        await tx
          .update(emails)
          .set({
            fromName: message.from.name,
            fromEmail: message.from.email,
            subject: message.subject,
            snippet: message.snippet,
            bodyText,
            bodyHtmlSanitized: bodyHtml,
            isUnread: message.isUnread,
            isStarred: message.isStarred,
            labels: message.labels,
            hasAttachments: message.attachments.length > 0 || current.hasAttachments,
          })
          .where(eq(emails.id, current.id));
      }
    }
  });
}

async function readLocalThreads(
  userId: string,
  view: string,
  query: string | undefined,
  onlyExternalIds?: string[],
): Promise<ThreadSummary[]> {
  const rows = await withUser(userId, async (tx) => {
    const threads = await tx
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.userId, userId))
      .orderBy(desc(emailThreads.lastMessageAt));
    const messageRows = await tx.select().from(emails).where(eq(emails.userId, userId));
    return { threads, messageRows };
  });
  const byThread = new Map<string, typeof rows.messageRows>();
  for (const message of rows.messageRows) {
    const list = byThread.get(message.threadId) ?? [];
    list.push(message);
    byThread.set(message.threadId, list);
  }
  return rows.threads
    .filter((thread) => (onlyExternalIds ? onlyExternalIds.includes(thread.externalId) : true))
    .filter((thread) => matchesView(thread.labels, view))
    .filter((thread) => !query || localQueryMatch(thread, byThread.get(thread.id) ?? [], query))
    .map((thread) => {
      const messages = byThread.get(thread.id) ?? [];
      const latest = [...messages].sort((a, b) => b.internalDate.getTime() - a.internalDate.getTime())[0];
      return {
        id: thread.id,
        source: thread.source as "gmail" | "demo",
        subject: thread.subject,
        snippet: thread.snippet,
        lastMessageAt: thread.lastMessageAt.toISOString(),
        fromName: latest?.fromName ?? null,
        fromEmail: latest?.fromEmail ?? "",
        isUnread: thread.isUnread,
        isStarred: thread.isStarred,
        isImportant: thread.isImportant,
        needsReply: thread.needsReply,
        hasAttachments: messages.some((message) => message.hasAttachments),
        labels: thread.labels,
        category: thread.category,
        messageCount: thread.messageCount,
      };
    });
}

async function loadThreadDetail(userId: string, threadId: string) {
  return withUser(userId, async (tx) => {
    const [thread] = await tx.select().from(emailThreads).where(eq(emailThreads.id, threadId)).limit(1);
    if (!thread) throw new HttpError(404, "NOT_FOUND", "Conversation not found");
    const messages = await tx
      .select()
      .from(emails)
      .where(eq(emails.threadId, threadId))
      .orderBy(emails.internalDate);
    const attachments = await tx.select().from(emailAttachments).where(eq(emailAttachments.userId, userId));
    return {
      id: thread.id,
      source: thread.source,
      subject: thread.subject,
      labels: thread.labels,
      synthetic: thread.source === "demo",
      messages: messages.map((message) => ({
        id: message.id,
        fromName: message.fromName,
        fromEmail: message.fromEmail,
        to: message.toEmails,
        cc: message.ccEmails,
        subject: message.subject,
        snippet: message.snippet,
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtmlSanitized,
        internalDate: message.internalDate.toISOString(),
        isUnread: message.isUnread,
        attachments: attachments
          .filter((attachment) => attachment.emailId === message.id)
          .map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          })),
      })),
    };
  });
}

async function requireThread(userId: string, threadId: string) {
  const [thread] = await withUser(userId, async (tx) =>
    tx.select().from(emailThreads).where(eq(emailThreads.id, threadId)).limit(1),
  );
  if (!thread) throw new HttpError(404, "NOT_FOUND", "Conversation not found");
  return thread;
}

async function touchSync(userId: string, source: "gmail" | "demo", status: string): Promise<void> {
  await withUser(userId, async (tx) => {
    await tx
      .insert(emailSyncState)
      .values({ userId, source, status, lastSyncAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: emailSyncState.userId,
        set: { source, status, lastSyncAt: new Date(), lastError: null, updatedAt: new Date() },
      });
  });
}

function matchesView(labels: string[], view: string): boolean {
  const trashed = labels.includes("TRASH");
  if (view === "trash") return trashed;
  if (trashed) return false;
  if (view === "sent") return labels.includes("SENT");
  if (view === "starred") return labels.includes("STARRED");
  if (view === "all") return true;
  return labels.includes("INBOX");
}

function viewToLabels(view: string): string[] | undefined {
  if (view === "sent") return ["SENT"];
  if (view === "starred") return ["STARRED"];
  if (view === "trash") return ["TRASH"];
  if (view === "all") return undefined;
  return ["INBOX"];
}

function localQueryMatch(
  thread: { subject: string; snippet: string; lastMessageAt: Date; isUnread: boolean; isStarred: boolean; labels: string[] },
  messages: Array<{ fromEmail: string; fromName: string | null; bodyText: string }>,
  query: string,
): boolean {
  const hay = [thread.subject, thread.snippet, ...messages.map((message) => `${message.fromName ?? ""} ${message.fromEmail} ${message.bodyText}`)]
    .join(" ")
    .toLowerCase();
  for (const token of query.toLowerCase().split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith("from:")) {
      const who = token.slice(5);
      if (!messages.some((message) => `${message.fromEmail} ${message.fromName ?? ""}`.toLowerCase().includes(who))) return false;
    } else if (token.startsWith("newer_than:")) {
      const days = Number(token.slice("newer_than:".length).replace(/d$/, ""));
      if (!Number.isFinite(days)) return false;
      if (Date.now() - thread.lastMessageAt.getTime() > days * 86_400_000) return false;
    } else if (token === "is:unread" && !thread.isUnread) return false;
    else if (token === "is:starred" && !thread.isStarred) return false;
    else if (token === "in:inbox" && !thread.labels.includes("INBOX")) return false;
    else if (!token.includes(":") && !hay.includes(token)) return false;
  }
  return true;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

export async function markOnboarded(userId: string, onboarded: boolean): Promise<void> {
  await withUser(userId, async (tx) => {
    await tx.update(profiles).set({ onboarded, updatedAt: new Date() }).where(eq(profiles.id, userId));
  });
}

export async function getPreferences(userId: string) {
  const [row] = await withUser(userId, async (tx) =>
    tx.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
  );
  return {
    loadRemoteImages: row?.loadRemoteImages ?? false,
    timezone: row?.timezone ?? "UTC",
  };
}

export async function updatePreferences(
  userId: string,
  patch: { loadRemoteImages?: boolean; timezone?: string; onboarded?: boolean },
) {
  await withUser(userId, async (tx) => {
    await tx
      .insert(userPreferences)
      .values({
        userId,
        loadRemoteImages: patch.loadRemoteImages ?? false,
        timezone: patch.timezone ?? "UTC",
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          ...(patch.loadRemoteImages == null ? {} : { loadRemoteImages: patch.loadRemoteImages }),
          ...(patch.timezone ? { timezone: patch.timezone } : {}),
          updatedAt: new Date(),
        },
      });
    if (patch.onboarded != null) {
      await tx.update(profiles).set({ onboarded: patch.onboarded, updatedAt: new Date() }).where(eq(profiles.id, userId));
    }
  });
  return getPreferences(userId);
}

export async function saveDraft(input: {
  userId: string;
  id?: string;
  threadId?: string | null;
  kind: "reply" | "compose";
  toEmail?: string;
  subject?: string;
  body: string;
}) {
  const [draft] = await withUser(input.userId, async (tx) => {
    if (input.id) {
      return tx
        .update(localDrafts)
        .set({
          body: input.body,
          toEmail: input.toEmail ?? "",
          subject: input.subject ?? "",
          updatedAt: new Date(),
        })
        .where(and(eq(localDrafts.id, input.id), eq(localDrafts.userId, input.userId)))
        .returning();
    }
    return tx
      .insert(localDrafts)
      .values({
        userId: input.userId,
        threadId: input.threadId ?? null,
        kind: input.kind,
        toEmail: input.toEmail ?? "",
        subject: input.subject ?? "",
        body: input.body,
      })
      .returning();
  });
  if (!draft) throw new HttpError(404, "NOT_FOUND", "Draft not found");
  return {
    id: draft.id,
    threadId: draft.threadId,
    kind: draft.kind,
    toEmail: draft.toEmail,
    subject: draft.subject,
    body: draft.body,
    updatedAt: draft.updatedAt.toISOString(),
    storedLocally: true,
    sent: false,
  };
}

export async function listDrafts(userId: string) {
  const rows = await withUser(userId, async (tx) =>
    tx.select().from(localDrafts).where(eq(localDrafts.userId, userId)).orderBy(desc(localDrafts.updatedAt)),
  );
  return rows.map((draft) => ({
    id: draft.id,
    threadId: draft.threadId,
    kind: draft.kind,
    toEmail: draft.toEmail,
    subject: draft.subject,
    body: draft.body,
    updatedAt: draft.updatedAt.toISOString(),
    storedLocally: true,
    sent: false,
  }));
}
