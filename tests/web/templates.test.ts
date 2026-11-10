import { describe, expect, it } from "vitest";
import type { Template } from "@shared/templates";
import { templateInputSchema } from "@shared/templates";
import { filterTemplates, isTemplateShortcut, templateToHtml } from "@/lib/templates";

const t = (name: string, body: string, subject = ""): Template => ({ id: name, name, subject, body, createdAt: "", updatedAt: "" });

describe("templates helpers", () => {
  const list = [t("Thanks", "Thank you so much"), t("Availability", "I'm free on Tuesday"), t("Intro", "Meet my colleague", "Introduction"), t("Out of office", "Back on Tuesday")];

  it("filters by name first, then subject/body", () => {
    expect(filterTemplates(list, "").map((x) => x.name)).toEqual(list.map((x) => x.name));
    expect(filterTemplates(list, "tues").map((x) => x.name)).toEqual(["Availability", "Out of office"]);
    expect(filterTemplates(list, "o").map((x) => x.name).slice(0, 1)).toEqual(["Out of office"]);
    expect(filterTemplates(list, "introduction").map((x) => x.name)).toEqual(["Intro"]);
    expect(filterTemplates(list, "zzz")).toEqual([]);
  });

  it("inserts templates as escaped paragraphs, never markup", () => {
    expect(templateToHtml("Hi <b>there</b>\r\nline 2\n\nBye")).toBe("<p>Hi &lt;b&gt;there&lt;/b&gt;<br>line 2</p><p>Bye</p>");
    expect(templateToHtml('<img src=x onerror="alert(1)">')).not.toContain("<img");
  });

  it("recognises the ⌘/Ctrl+; shortcut only", () => {
    const k = (o: Partial<KeyboardEvent>) => ({ key: ";", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
    expect(isTemplateShortcut(k({ ctrlKey: true }))).toBe(true);
    expect(isTemplateShortcut(k({ metaKey: true }))).toBe(true);
    expect(isTemplateShortcut(k({}))).toBe(false);
    expect(isTemplateShortcut(k({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isTemplateShortcut(k({ key: "k", ctrlKey: true }))).toBe(false);
  });

  it("validates template input", () => {
    expect(templateInputSchema.safeParse({ name: " Hi ", body: "x" }).data).toEqual({ name: "Hi", subject: "", body: "x" });
    expect(templateInputSchema.safeParse({ name: "Hi", subject: "a\nb", body: "x" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ name: "Hi", body: "line1\nline2\ttab" }).success).toBe(true);
  });
});
