import { describe, expect, it } from "vitest";
import { gmailResourcePath } from "../../server/gmail/client.js";

/**
 * Gmail REST base is https://gmail.googleapis.com/gmail/v1.
 * Every resource lives under /users/{userId}/... ("me" for the authorized account).
 * Call sites pass short paths (/threads, /labels); the client must scope them.
 */
describe("gmailResourcePath", () => {
  it("prefixes /users/me for standard resource paths", () => {
    expect(gmailResourcePath("/threads")).toBe("/users/me/threads");
    expect(gmailResourcePath("/threads/abc123")).toBe("/users/me/threads/abc123");
    expect(gmailResourcePath("/threads/abc123/modify")).toBe("/users/me/threads/abc123/modify");
    expect(gmailResourcePath("/labels")).toBe("/users/me/labels");
    expect(gmailResourcePath("/labels/INBOX")).toBe("/users/me/labels/INBOX");
    expect(gmailResourcePath("/profile")).toBe("/users/me/profile");
    expect(gmailResourcePath("/messages/send")).toBe("/users/me/messages/send");
    expect(gmailResourcePath("/messages/batchModify")).toBe("/users/me/messages/batchModify");
    expect(gmailResourcePath("/drafts")).toBe("/users/me/drafts");
    expect(gmailResourcePath("/settings/filters")).toBe("/users/me/settings/filters");
    expect(gmailResourcePath("/settings/sendAs")).toBe("/users/me/settings/sendAs");
  });

  it("leaves paths that already include /users/ unchanged", () => {
    expect(gmailResourcePath("/users/me/threads")).toBe("/users/me/threads");
    expect(gmailResourcePath("/users/someone@example.com/profile")).toBe("/users/someone@example.com/profile");
  });

  it("normalizes paths without a leading slash", () => {
    expect(gmailResourcePath("threads")).toBe("/users/me/threads");
    expect(gmailResourcePath("labels/INBOX")).toBe("/users/me/labels/INBOX");
  });

  it("builds URLs that match the official Gmail API shape", () => {
    const base = "https://gmail.googleapis.com/gmail/v1";
    expect(`${base}${gmailResourcePath("/threads")}`).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/threads",
    );
    expect(`${base}${gmailResourcePath("/profile")}`).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    );
  });
});
