import { describe, expect, it } from "vitest";
import ar from "../i18n/ar.json";
import { FAMILIES } from "./definition";
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
    // The list prints in full on failure, ready to translate.
    expect(missing).toEqual([]);
  });

  it("writes every Claude request and every sample in both languages", () => {
    for (const p of PACK_DEFS) {
      for (const pr of p.prompts ?? []) expect(typeof pr.prompt === "object" && pr.prompt.ar && pr.prompt.en, `${p.id}: ${pr.label}`).toBeTruthy();
      for (const s of p.samples ?? []) expect(typeof s.title === "object", `${p.id} sample title`).toBe(true);
    }
  });
});
