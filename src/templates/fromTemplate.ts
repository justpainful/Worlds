/** Making pages from templates, in Arabic when the template is an untouched built-in one. */
import { api } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { uiLanguage } from "../i18n/ui";
import { arabicTemplate, fillDate } from "./builtinArabic";

/** A new page from a template; an Arabic interface gets the Arabic built-in content. */
export function pageFromTemplate(t: PageMeta, parentId: string | null = null): Promise<PageMeta> {
  const ar = uiLanguage() === "ar" ? arabicTemplate(t) : null;
  if (ar?.markdown) return api.createPage({ title: fillDate(ar.title), icon: t.icon, parentId, markdown: fillDate(ar.markdown) });
  return api.instantiate(t.id, parentId);
}

export { templateDescription, templateName } from "./templateNames";
