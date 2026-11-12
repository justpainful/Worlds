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

/** Built-in maps are named in both languages, English then Arabic after a long dash. */
const BILINGUAL = /^([^\u0600-\u06FF]+?) \u2014 (.*[\u0600-\u06FF].*)$/;

/** A template's name as cards and chips show it: no date placeholder, and one language. */
export function templateName(t: PageMeta): string {
  const ar = uiLanguage() === "ar" ? arabicTemplate(t) : null;
  const name = (ar?.title ?? t.title).replace("{{date}}", "").trim();
  const pair = BILINGUAL.exec(name);
  return pair ? (uiLanguage() === "ar" ? pair[2] : pair[1]) : name;
}

/** A template's one line description, when it is a built-in one shown in Arabic. */
export function templateDescription(t: PageMeta): string | null {
  return uiLanguage() === "ar" ? (arabicTemplate(t)?.description ?? null) : null;
}
