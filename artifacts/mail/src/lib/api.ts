export class ApiClientError extends Error {
  status: number;
  code: string;
  missing?: string[];

  constructor(status: number, code: string, message: string, missing?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.missing = missing;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("fluent_csrf");
    if (csrf) headers.set("x-fluent-csrf", csrf);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const data = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; missing?: string[] } }
    | null;
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      data?.error?.code ?? "HTTP",
      data?.error?.message ?? "Request failed",
      data?.error?.missing,
    );
  }
  return data as T;
}

function readCookie(name: string): string | undefined {
  const parts = document.cookie.split("; ");
  const found = parts.find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : undefined;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  isDemo: boolean;
  onboarded: boolean;
}

export interface SetupConfig {
  googleLogin: "ready" | "blocked";
  gmailConnect: "ready" | "blocked";
  encryption: "ready" | "blocked";
  ai: "live" | "mock" | "blocked";
  demoMode: boolean;
  missing: string[];
  gmailScope: {
    scope: string;
    includesSend: boolean;
    includesPermanentDelete: boolean;
    applicationSendEnabled: boolean;
    applicationDraftWriteEnabled: boolean;
    applicationPermanentDeleteEnabled: boolean;
  };
}

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

export interface ThreadDetail {
  id: string;
  source: string;
  subject: string;
  labels: string[];
  synthetic: boolean;
  messages: Array<{
    id: string;
    fromName: string | null;
    fromEmail: string;
    to: string[];
    cc: string[];
    subject: string;
    bodyText: string;
    bodyHtml: string;
    internalDate: string;
    isUnread: boolean;
    attachments: Array<{ filename: string; mimeType: string | null; sizeBytes: number | null }>;
  }>;
}
