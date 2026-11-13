import { describe, expect, it } from "vitest";
import { STUDY } from "./definitions/study";
import { PACK_DEFS, enabledPacks, hiddenKindsFor, isPackKind, kindDefOf, packOfKind, PACKS, PACKS_KEY } from "./registry";

describe("pack registry", () => {
  it("builds the Study pack from its definition with the kinds it always had", () => {
    expect(PACKS.find((p) => p.id === "study")?.kinds).toEqual(["subject", "lesson", "assignment", "exam", "requirement"]);
    expect(kindDefOf("assignment")?.dataKey).toBe("assignment");
    expect(kindDefOf("assignment")?.pack.id).toBe("study");
    expect(packOfKind("exam")?.id).toBe("study");
    expect(packOfKind("page")).toBeUndefined();
  });

  it("recognises pack kinds by their shape", () => {
    expect(isPackKind("freelance.invoice")).toBe(true);
    expect(isPackKind("assignment")).toBe(false);
    expect(isPackKind("a.b.c")).toBe(false);
    expect(isPackKind("Free.lance")).toBe(false);
  });

  it("hides a pack's kinds while it is off and shows them when it is on", () => {
    expect(hiddenKindsFor({}).has("subject")).toBe(true);
    expect(hiddenKindsFor({ [PACKS_KEY]: ["study"] }).has("subject")).toBe(false);
    expect([...enabledPacks({ [PACKS_KEY]: ["study", "gone"] })]).toEqual(["study"]);
  });

  it("checks every definition is consistent", () => {
    for (const pack of PACK_DEFS) {
      const kindIds = new Set(pack.kinds.map((k) => k.id));
      const viewIds = new Set(pack.views.map((v) => v.id));
      expect(pack.sidebar.every((id) => viewIds.has(id)), `${pack.id} sidebar`).toBe(true);
      for (const v of pack.views) {
        if (v.type === "custom") expect(v.component, `${pack.id}.${v.id}`).toBeTruthy();
        else expect(kindIds.has(v.kind ?? ""), `${pack.id}.${v.id} kind`).toBe(true);
        const kind = pack.kinds.find((k) => k.id === v.kind);
        for (const c of v.columns ?? []) expect(kind?.fields.some((f) => f.id === c), `${pack.id}.${v.id} column ${c}`).toBe(true);
        if (v.groupBy) expect(kind?.fields.find((f) => f.id === v.groupBy)?.options?.length, `${pack.id}.${v.id} groupBy`).toBeTruthy();
      }
      for (const k of pack.newMenu ?? []) expect(kindIds.has(k), `${pack.id} newMenu ${k}`).toBe(true);
      for (const k of pack.kinds) {
        const ids = k.fields.map((f) => f.id);
        expect(new Set(ids).size, `${pack.id}.${k.id} unique fields`).toBe(ids.length);
        for (const ref of [k.dateField, k.stageField, k.doneField]) if (ref) expect(ids, `${pack.id}.${k.id} ${ref}`).toContain(ref);
      }
    }
    expect(PACK_DEFS).toContain(STUDY);
  });
});
