import { describe, expect, it } from "vitest";
import { analyticsBeforeSend, analyticsPath, sanitizeAnalyticsUrl } from "@/lib/analytics";

describe("analytics URL sanitising", () => {
  it.each([
    ["/", "/"],
    ["/privacy", "/privacy"],
    ["/app", "/app"],
    ["/app/inbox", "/app/inbox"],
    ["/app/inbox/", "/app/inbox"],
    ["/app/inbox/0b8e6c1a-acc/18c2f00dthread", "/app/inbox/thread"],
    ["/app/all/acc-1/t-1", "/app/all/thread"],
    ["/app/settings/privacy", "/app/settings/privacy"],
    ["/app/settings/Some Name/x", "/app/other"],
    ["/app/Label_123", "/app/other"],
    ["/app/alex@example.com", "/app/other"],
    ["/random/alex@example.com", "/not-found"],
  ])("%s -> %s", (input, out) => {
    expect(analyticsPath(input)).toBe(out);
  });

  it("drops query strings and fragments (search terms, label names, account ids)", () => {
    expect(sanitizeAnalyticsUrl("https://fluent.example/app/search?q=invoice%20from%20alex&account=a1#x")).toBe("https://fluent.example/app/search");
    expect(sanitizeAnalyticsUrl("https://fluent.example/app/label?label=Label_9&name=Secret%20Project")).toBe("https://fluent.example/app/label");
    expect(sanitizeAnalyticsUrl("not a url")).toBe("/");
  });

  it("sanitises page views and drops custom events", () => {
    expect(analyticsBeforeSend({ type: "pageview", url: "https://f.example/app/inbox/acc/thr?q=x" })).toEqual({ type: "pageview", url: "https://f.example/app/inbox/thread" });
    expect(analyticsBeforeSend({ type: "event", url: "https://f.example/app/inbox" })).toBeNull();
  });
});
