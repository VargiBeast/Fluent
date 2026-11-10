import { describe, expect, it } from "vitest";
import { noteDraft } from "@/lib/notes";

describe("noteDraft", () => {
  it("keeps the text but drops trailing whitespace and normalises newlines", () => {
    expect(noteDraft("  hi\r\nthere  \n\n")).toBe("  hi\nthere");
  });
  it("returns null for an empty note", () => {
    expect(noteDraft("")).toBeNull();
    expect(noteDraft(" \n\t ")).toBeNull();
  });
});
