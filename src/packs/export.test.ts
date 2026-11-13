/**
 * The pack definitions as JSON for the Android and Apple apps (docs/PACKS.md,
 * Design 4), with every label in English and Arabic, so the native apps read
 * the same kinds, fields and views as desktop without their own copy.
 *
 * The test fails when a committed copy is out of date. To write them again:
 *   WORLDS_WRITE_PACKS=1 node node_modules/vitest/vitest.mjs run src/packs/export.test.ts
 */
import { describe, expect, it } from "vitest";
import ar from "../i18n/ar.json";
import { loadDictionary, translate } from "../i18n/ui";
import { dataKeyOf, FAMILIES, storedKind } from "./definition";
import { PACK_DEFS } from "./registry";

const TARGETS = ["Android/app/src/main/assets/packs.json", "Apple/App/Packs/packs.json"];

function exportPacks(): string {
  loadDictionary(ar as Record<string, string>);
  const both = (en: string) => ({ en, ar: translate(en) ?? en });
  const doc = {
    version: 1,
    families: FAMILIES.map((f) => ({ id: f.id, label: both(f.label), icon: f.icon })),
    packs: PACK_DEFS.map((p) => ({
      id: p.id,
      family: p.family,
      label: both(p.label),
      blurb: both(p.blurb),
      icon: p.icon,
      kinds: p.kinds.map((k) => ({
        id: k.id,
        kind: storedKind(p, k),
        dataKey: dataKeyOf(k),
        label: both(k.label),
        plural: both(k.plural),
        icon: k.icon,
        dateField: k.dateField ?? null,
        stageField: k.stageField ?? null,
        doneField: k.doneField ?? null,
        fields: k.fields.map((f) => ({
          id: f.id,
          label: both(f.label),
          type: f.type,
          options: f.options?.map((o) => ({ id: o.id, label: both(o.label), color: o.color ?? null })) ?? null,
          to: f.to ?? null,
          currency: f.type === "money" ? (f.currency ?? "SAR") : null,
          detailOnly: !!f.detailOnly,
        })),
      })),
      // Views a native app can draw from data alone; custom ones stay on desktop for now.
      views: p.views
        .filter((v) => v.type !== "custom")
        .map((v) => ({ id: v.id, label: both(v.label), type: v.type, kind: v.kind, groupBy: v.groupBy ?? null, columns: v.columns ?? null })),
      sidebar: p.sidebar.filter((id) => p.views.some((v) => v.id === id && v.type !== "custom")),
    })),
  };
  return JSON.stringify(doc, null, 1) + "\n";
}

describe("pack definitions for the native apps", () => {
  it("are exported and current", async () => {
    const text = exportPacks();
    // Node's file system, loaded only here (the app's sources do not use it).
    const fs = await import(/* @vite-ignore */ "node:" + "fs");
    const path = await import(/* @vite-ignore */ "node:" + "path");
    // Tests run from the repository root.
    const proc = (globalThis as { process?: { cwd(): string; env: Record<string, string | undefined> } }).process!;
    const root = proc.cwd();
    const env = proc.env;
    for (const rel of TARGETS) {
      const file = path.join(root, rel);
      if (env.WORLDS_WRITE_PACKS) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
      }
      const committed = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      expect(committed === text, `${rel} is out of date; run with WORLDS_WRITE_PACKS=1`).toBe(true);
    }
  });
});
