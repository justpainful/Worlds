/**
 * What Claude is told about the packs a person turned on: each kind's stored
 * name and its fields, so it can list, create and change pack items with the
 * resources and items tools. The app keeps this text in the `packs.ai`
 * setting, and the backend adds it to Claude's instructions.
 */
import { dataKeyOf, storedKind, type FieldDef, type PackDef } from "./definition";
import { enabledPacks, PACK_DEFS } from "./registry";

/** Settings key the backend reads for Claude's instructions. */
export const PACKS_AI_KEY = "packs.ai";

function describeField(pack: PackDef, f: FieldDef): string {
  switch (f.type) {
    case "choice":
    case "stage":
      return `${f.id} (${f.type}: ${(f.options ?? []).map((o) => `${o.id}=${o.label}`).join(", ")})`;
    case "link": {
      const to = pack.kinds.find((k) => k.id === f.to);
      return `${f.id} (link to a ${to ? storedKind(pack, to) : f.to} id)`;
    }
    case "money":
      return `${f.id} (money, ${f.currency ?? "SAR"})`;
    default:
      return `${f.id} (${f.type})`;
  }
}

/** The text for the packs that are on, or an empty string when none are. */
export function packsForClaude(packs: PackDef[]): string {
  const out: string[] = [];
  for (const pack of packs) {
    out.push(`${pack.label} pack:`);
    for (const k of pack.kinds) {
      const stored = storedKind(pack, k);
      const key = dataKeyOf(k);
      const where = key === "item" ? "" : ` (fields under ${key})`;
      out.push(`- ${k.label}: kind ${stored}${where}. Fields: ${k.fields.map((f) => describeField(pack, f)).join("; ")}`);
    }
  }
  return out.join("\n");
}

/** The text for the packs turned on in these settings. */
export function packsForClaudeFrom(settings: Record<string, unknown>): string {
  const on = enabledPacks(settings);
  return packsForClaude(PACK_DEFS.filter((p) => on.has(p.id)));
}
