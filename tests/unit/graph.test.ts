import { describe, expect, it } from "vitest";
import { graphQuery, toFluentId, toGraphId } from "../../server/providers/graph.js";

describe("Graph ids", () => {
  it("round-trip base64 ids through URL-safe FLUENT ids", () => {
    const raw = "AAMkAD+abc/def==";
    const id = toFluentId(raw);
    expect(id).toBe("AAMkAD.abc~def==");
    expect(decodeURIComponent(toGraphId(id))).toBe(raw);
    expect(toGraphId(id)).not.toContain("/");
  });
  it("rejects anything else", () => {
    for (const bad of ["", "a/b", "a b", "../me", "x".repeat(257), "a%2Fb"]) expect(() => toGraphId(bad)).toThrow();
  });
});

describe("graphQuery", () => {
  it("maps is: operators to filters and folders", () => {
    expect(graphQuery("is:unread is:starred", "inbox")).toEqual({ filter: ["isRead eq false", "flag/flagStatus eq 'flagged'"], search: null });
    expect(graphQuery("", "important").filter).toEqual(["importance eq 'high'"]);
    expect(graphQuery("category:promotions label:x", "inbox")).toEqual({ filter: [], search: null });
  });
  it("keeps user text inside the quoted $search", () => {
    expect(graphQuery('from:ola@example.org "lunch" \\ x', "inbox").search).toBe("from:ola@example.org lunch x");
  });
});
