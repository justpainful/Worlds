/**
 * Fields some pack role must not see (a product's cost, a student's guardian
 * phone) travel in their own document in team sync, `<pageId>__hidden__<pack>`,
 * which the server does not open for members whose role in that pack is
 * restricted (docs/PACKS.md, Design 2). Everything else stays in the page's
 * own document. These helpers are the pure part.
 */
import type { PackDef, RoleDef } from "./definition";
import type { ItemData } from "./fields";

export const HIDDEN_SEPARATOR = "__hidden__";

export function hiddenDocId(pageId: string, packId: string): string {
  return `${pageId}${HIDDEN_SEPARATOR}${packId}`;
}

/** Every field any role of the pack must not see. */
export function hiddenKeys(pack: PackDef): Set<string> {
  return new Set(pack.roles.flatMap((r) => r.hiddenFields ?? []));
}

/** Whether a role is kept out of the hidden document. */
export const isRestricted = (role: RoleDef) => !!role.hiddenFields?.length;

export function splitFields(fields: ItemData, keys: Set<string>): { open: ItemData; hidden: ItemData } {
  const open: ItemData = {};
  const hidden: ItemData = {};
  for (const [k, v] of Object.entries(fields)) (keys.has(k) ? hidden : open)[k] = v;
  return { open, hidden };
}

/**
 * The item's fields from both documents. Hidden fields come from the hidden
 * document when this device could open it; otherwise the ones it already
 * had stay as they are (a restricted member never had them).
 */
export function combineFields(open: ItemData, hidden: ItemData | null, local: ItemData, keys: Set<string>): ItemData {
  const out: ItemData = {};
  for (const [k, v] of Object.entries(open)) if (!keys.has(k)) out[k] = v;
  const fromHidden = hidden ?? splitFields(local, keys).hidden;
  for (const [k, v] of Object.entries(fromHidden)) if (keys.has(k)) out[k] = v;
  return out;
}
