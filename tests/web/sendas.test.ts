import { describe, expect, it } from "vitest";
import { sendAsPatchSchema } from "@shared/sendas";
import { isEmptySignature, signatureNeedsRichEditor } from "@/lib/sendas";

describe("send-as helpers", () => {
  it("flags signatures the simple editor would flatten", () => {
    expect(signatureNeedsRichEditor('<div>Alex<br><img src="https://x/logo.png"></div>')).toBe(true);
    expect(signatureNeedsRichEditor('<span style="color:red">Alex</span>')).toBe(true);
    expect(signatureNeedsRichEditor('<font color="#888">Alex</font>')).toBe(true);
    expect(signatureNeedsRichEditor("<table><tr><td>A</td></tr></table>")).toBe(true);
    expect(signatureNeedsRichEditor('<p>Alex <b>Morgan</b><br><a href="https://x.test">site</a></p>')).toBe(false);
  });

  it("treats Gmail's blank signatures as empty", () => {
    expect(isEmptySignature("")).toBe(true);
    expect(isEmptySignature("<div><br></div>")).toBe(true);
    expect(isEmptySignature("<p>&nbsp;</p>")).toBe(true);
    expect(isEmptySignature("<div>Alex</div>")).toBe(false);
  });

  it("validates patches", () => {
    expect(sendAsPatchSchema.safeParse({}).success).toBe(false);
    expect(sendAsPatchSchema.safeParse({ displayName: " Alex " }).data).toEqual({ displayName: "Alex" });
    expect(sendAsPatchSchema.safeParse({ displayName: "A\nB" }).success).toBe(false);
    expect(sendAsPatchSchema.safeParse({ signature: "" }).success).toBe(true);
  });
});
