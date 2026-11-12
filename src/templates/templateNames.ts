/** Template names and descriptions as the interface shows them (no backend calls, so tests can load it). */
import type { PageMeta } from "../lib/types";
import { uiLanguage } from "../i18n/ui";
import { arabicTemplate } from "./builtinArabic";

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
