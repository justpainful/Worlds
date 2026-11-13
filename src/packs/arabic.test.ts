import { describe, expect, it } from "vitest";
import ar from "../i18n/ar.json";
import { loadDictionary, translate } from "../i18n/ui";
import { FAMILIES } from "./definition";
import { inSentence } from "./fields";
import { PACK_DEFS } from "./registry";

/** Every text a pack shows, written in English in its definition. */
function packStrings(): string[] {
  const out = new Set<string>();
  const add = (s?: string) => s && out.add(s);
  for (const f of FAMILIES) add(f.label);
  for (const p of PACK_DEFS) {
    add(p.label);
    add(p.blurb);
    p.adds.forEach(add);
    for (const k of p.kinds) {
      add(k.label);
      add(k.plural);
      add(k.blurb);
      for (const f of k.fields) {
        add(f.label);
        f.options?.forEach((o) => add(o.label));
      }
    }
    p.views.forEach((v) => add(v.label));
    p.roles.forEach((r) => add(r.label));
    p.stats?.forEach((s) => add(s.label));
    p.alerts?.forEach((a) => add(a.label));
    p.prompts?.forEach((a) => add(a.label));
  }
  return [...out];
}

describe("packs in Arabic", () => {
  it("has an Arabic translation for every text of every pack", () => {
    const missing = packStrings().filter((s) => !(s in (ar as Record<string, string>)));
    // Printed in full, ready to translate, when anything is missing.
    if (missing.length) console.log(`PACK_STRINGS_MISSING ${JSON.stringify(missing)}`);
    expect(missing).toEqual([]);
  });

  it("writes every Claude request and every sample in both languages", () => {
    for (const p of PACK_DEFS) {
      for (const pr of p.prompts ?? []) expect(typeof pr.prompt === "object" && pr.prompt.ar && pr.prompt.en, `${p.id}: ${pr.label}`).toBeTruthy();
      for (const s of p.samples ?? []) expect(typeof s.title === "object", `${p.id} sample title`).toBe(true);
    }
  });

  it("reads every button sentence as Arabic: add, delete, none yet, view as", () => {
    const dict = ar as Record<string, string>;
    loadDictionary(dict);
    const tr = (t: string) => translate(t) ?? t;
    const wrong: string[] = [];
    // A sentence is right when the general pattern gives the word's own translation, or the dictionary has the whole sentence.
    const check = (en: string, want: string) => {
      if (en in dict) return;
      const got = tr(en);
      if (got !== want) wrong.push(`${en} -> ${got}`);
    };
    for (const p of PACK_DEFS) {
      for (const k of p.kinds) {
        check(`Add ${inSentence(k.label)}`, `إضافة ${tr(k.label)}`);
        check(`Delete ${inSentence(k.label)}`, `حذف ${tr(k.label)}`);
      }
      for (const r of p.roles) check(`As ${inSentence(r.label)}`, `بصفة ${tr(r.label)}`);
    }
    expect(wrong).toEqual([]);
  });
});
