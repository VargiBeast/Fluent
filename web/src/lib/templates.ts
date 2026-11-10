import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Template, TemplateInput } from "@shared/templates";
import { api } from "./api";
import { textToParagraphs } from "./compose";

export const TEMPLATES_KEY = ["templates"] as const;

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: TEMPLATES_KEY,
    enabled,
    queryFn: () => api.get<{ templates: Template[] }>("/templates").then((r) => r.templates),
    staleTime: 5 * 60_000,
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...t }: TemplateInput & { id?: string }) => (id ? api.put<Template>(`/templates/${id}`, t) : api.post<Template>("/templates", t)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/templates/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

/** Case-insensitive match on name first, then subject/body; name matches rank above body matches. */
export function filterTemplates(list: Template[], query: string): Template[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const rank = (t: Template) => (t.name.toLowerCase().startsWith(q) ? 0 : t.name.toLowerCase().includes(q) ? 1 : `${t.subject}\n${t.body}`.toLowerCase().includes(q) ? 2 : -1);
  return list.map((t) => ({ t, r: rank(t) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).map((x) => x.t);
}

/** Templates are plain text; insert them as escaped paragraphs so nothing in a template can become markup. */
export function templateToHtml(body: string): string {
  return textToParagraphs(body.replace(/\r\n?/g, "\n"));
}

export const TEMPLATE_SHORTCUT_LABEL = "⌘/Ctrl + ;";
export function isTemplateShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return e.key === ";" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}
