import { describe, expect, it } from "vitest";
import { FAMILIES, type Condition } from "./definition";
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

  it("has the 38 packs of the plan besides Study, in every family", () => {
    expect(PACK_DEFS.filter((p) => p.id !== "study")).toHaveLength(38);
    for (const f of FAMILIES) expect(PACK_DEFS.some((p) => p.family === f.id), f.id).toBe(true);
  });

  it("checks links, rules, samples and icons of every definition", () => {
    // Only committed icons: a machine-local one would pass here and be missing everywhere else.
    const icons = new Set(Object.keys(import.meta.glob("../assets/product-icons/*.{svg,png}")).map((p) => p.split("/").pop()!.replace(/\.(svg|png)$/, "")));
    const packIds = PACK_DEFS.map((p) => p.id);
    expect(new Set(packIds).size, "unique pack ids").toBe(packIds.length);
    for (const pack of PACK_DEFS) {
      expect(pack.id, "pack id shape").toMatch(/^[a-z][a-z0-9]*$/);
      expect(FAMILIES.some((f) => f.id === pack.family), `${pack.id} family`).toBe(true);
      expect(icons.has(pack.icon), `${pack.id} icon ${pack.icon}`).toBe(true);
      expect(pack.roles.length, `${pack.id} roles`).toBeGreaterThan(0);
      const fieldOf = (kindId: string, fieldId: string) => pack.kinds.find((k) => k.id === kindId)?.fields.find((f) => f.id === fieldId);
      const checkWhere = (where: Condition[] | undefined, kindId: string, what: string) => {
        for (const c of where ?? []) {
          expect(fieldOf(kindId, c.field), `${pack.id} ${what} field ${c.field}`).toBeTruthy();
          if (typeof c.atMost === "string") expect(fieldOf(kindId, c.atMost), `${pack.id} ${what} atMost`).toBeTruthy();
          for (const other of c.clashesOn ?? []) expect(fieldOf(kindId, other), `${pack.id} ${what} clashesOn ${other}`).toBeTruthy();
        }
      };
      for (const k of pack.kinds) {
        expect(k.id, `${pack.id} kind id shape`).toMatch(/^[a-z][a-z0-9]*$/);
        expect(icons.has(k.icon), `${pack.id}.${k.id} icon ${k.icon}`).toBe(true);
        if (!k.kind) expect(isPackKind(`${pack.id}.${k.id}`)).toBe(true);
        if (k.publish) {
          expect(pack.roles.some((r) => r.id === k.publish!.role), `${pack.id}.${k.id} publishes to a role`).toBe(true);
          const [tp, tk] = k.publish.target.split(".");
          const target = PACK_DEFS.find((p) => p.id === tp)?.kinds.find((x) => x.id === tk);
          expect(target, `${pack.id}.${k.id} publishes to ${k.publish.target}`).toBeTruthy();
          for (const [to, from] of Object.entries(k.publish.fields)) {
            expect(target?.fields.some((f) => f.id === to), `${k.publish.target}.${to}`).toBe(true);
            expect(k.fields.some((f) => f.id === from), `${pack.id}.${k.id}.${from}`).toBe(true);
          }
        }
        for (const fld of k.fields) {
          if (fld.type === "link") expect(pack.kinds.some((x) => x.id === fld.to), `${pack.id}.${k.id}.${fld.id} links to ${fld.to}`).toBe(true);
          if (fld.type === "choice" || fld.type === "stage") expect(fld.options?.length, `${pack.id}.${k.id}.${fld.id} options`).toBeTruthy();
          for (const src of fld.compute?.of ?? []) expect(fieldOf(k.id, src)?.type, `${pack.id}.${k.id}.${fld.id} computes from ${src}`).toMatch(/number|money/);
        }
      }
      for (const v of pack.views) {
        if (!v.kind) continue;
        checkWhere(v.filter, v.kind, `view ${v.id}`);
        for (const id of [...(v.totals ?? []), ...(v.averages ?? [])]) expect(fieldOf(v.kind, id)?.type, `${pack.id}.${v.id} total ${id}`).toMatch(/number|money/);
        // A total only shows for a column that is on screen.
        if (v.columns) for (const id of [...(v.totals ?? []), ...(v.averages ?? [])]) expect(v.columns, `${pack.id}.${v.id} total column`).toContain(id);
      }
      for (const st of pack.stats ?? []) {
        expect(pack.kinds.some((k) => k.id === st.kind), `${pack.id} stat ${st.label}`).toBe(true);
        if (st.agg !== "count") expect(fieldOf(st.kind, st.field ?? "")?.type, `${pack.id} stat ${st.label} field`).toMatch(/number|money/);
        checkWhere(st.where, st.kind, `stat ${st.label}`);
      }
      for (const al of pack.alerts ?? []) checkWhere(al.where, al.kind, `alert ${al.label}`);
      const refs = new Set<string>();
      for (const sm of pack.samples ?? []) {
        expect(pack.kinds.some((k) => k.id === sm.kind), `${pack.id} sample kind ${sm.kind}`).toBe(true);
        for (const [key, value] of Object.entries(sm.data ?? {})) {
          const fld = fieldOf(sm.kind, key);
          expect(fld, `${pack.id} sample ${sm.kind}.${key}`).toBeTruthy();
          if (fld?.type === "link") expect(refs.has(String(value)), `${pack.id} sample link ${key} -> ${String(value)}`).toBe(true);
          if (fld?.type === "choice" || fld?.type === "stage") expect(fld.options?.some((o) => o.id === value), `${pack.id} sample ${key}=${String(value)}`).toBe(true);
        }
        if (sm.ref) refs.add(sm.ref);
      }
    }
  });
});
