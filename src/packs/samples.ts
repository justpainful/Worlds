/**
 * Sample items a pack can add so a person sees it working before typing
 * anything. Text is in the interface language; links between samples name
 * each other by ref and become page ids as the items are made.
 */
import { uiLanguage } from "../i18n/ui";
import type { PageMeta } from "../lib/types";
import type { Bilingual, PackDef, SampleDef } from "./definition";
import { addDaysIso, todayIso } from "./rules";

export function inLanguage(text: Bilingual, lang: "en" | "ar" = uiLanguage() === "ar" ? "ar" : "en"): string {
  return typeof text === "string" ? text : text[lang];
}

/**
 * A sample's field values as stored: bilingual text in one language, links as
 * page ids, and dates written "+3" (days from today) as real dates, so the
 * samples always look current.
 */
export function sampleData(pack: PackDef, sample: SampleDef, ids: Map<string, string>, today: string, lang: "en" | "ar"): Record<string, unknown> {
  const kind = pack.kinds.find((k) => k.id === sample.kind);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(sample.data ?? {})) {
    const field = kind?.fields.find((f) => f.id === key);
    let v: unknown = raw;
    if (v && typeof v === "object" && !Array.isArray(v) && "en" in v && "ar" in v) v = inLanguage(v as Bilingual, lang);
    if (field?.type === "link" && typeof v === "string") v = ids.get(v) ?? null;
    if (field?.type === "date" && typeof v === "string" && /^[+-]\d+$/.test(v)) v = addDaysIso(today, Number(v));
    out[key] = v;
  }
  return out;
}

/** Add a pack's samples in order. Returns how many were made. */
export async function addSamples(pack: PackDef, create: (sample: SampleDef, data: Record<string, unknown>, title: string) => Promise<PageMeta | null>): Promise<number> {
  const ids = new Map<string, string>();
  const today = todayIso();
  const lang = uiLanguage() === "ar" ? "ar" : "en";
  let made = 0;
  for (const sample of pack.samples ?? []) {
    const page = await create(sample, sampleData(pack, sample, ids, today, lang), inLanguage(sample.title, lang));
    if (!page) continue;
    made++;
    if (sample.ref) ids.set(sample.ref, page.id);
  }
  return made;
}
