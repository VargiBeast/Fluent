import { describe, expect, it } from "vitest";
import { filterCommands, matchScore, type Command } from "../../web/src/app/commands";

const cmds: Command[] = [
  { id: "inbox", group: "Go to", title: "Inbox" },
  { id: "compose", group: "Actions", title: "Compose new email", keywords: "write new message" },
  { id: "archive", group: "Conversation", title: "Archive conversation" },
  { id: "privacy", group: "Settings", title: "Privacy dashboard", keywords: "ai log exclusions export" },
];

describe("command palette filter", () => {
  it("returns everything for an empty query", () => {
    expect(filterCommands(cmds, "  ")).toHaveLength(4);
  });
  it("ranks prefix and word-start matches first", () => {
    expect(filterCommands(cmds, "arch")[0]!.id).toBe("archive");
    expect(filterCommands(cmds, "inb")[0]!.id).toBe("inbox");
    expect(matchScore("conv", "Archive conversation")).toBeGreaterThan(matchScore("onv", "Archive conversation"));
  });
  it("matches subsequences and keywords", () => {
    expect(filterCommands(cmds, "cmp").map((c) => c.id)).toContain("compose");
    expect(filterCommands(cmds, "export").map((c) => c.id)).toEqual(["privacy"]);
    expect(filterCommands(cmds, "zzz")).toEqual([]);
  });
});
