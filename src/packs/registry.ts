/**
 * Packs: optional sets of features a person turns on for what they use Worlds
 * for. Worlds itself stays general; a pack adds kinds, sidebar entries, Home
 * sections and commands. While a pack is off, nothing of it shows anywhere,
 * and anything made with it is kept, hidden, and comes back when it is turned
 * on again. See docs/PACKS.md.
 *
 * Every pack is a definition (src/packs/definitions); this module turns the
 * definitions into what the rest of the app asks: which kinds exist, which
 * are hidden, which pack owns a kind. It has no store dependency so the
 * store's own selectors can use it. Hooks and actions live in ./packs.ts.
 */
import type { PageMeta } from "../lib/types";
import { dataKeyOf, storedKind, type FamilyId, type KindDef, type PackDef } from "./definition";
import { STUDY } from "./definitions/study";

/** Every pack Worlds knows, in the order Settings lists them. */
export const PACK_DEFS: PackDef[] = [STUDY];

export type PackId = string;

export interface PackInfo {
  id: PackId;
  family: FamilyId;
  label: string;
  /** One sentence for the Settings row and the chooser. */
  blurb: string;
  /** Product icon (src/assets/product-icons). */
  icon: string;
  /** Stored kinds that exist only while this pack is on. */
  kinds: string[];
  /** What it adds, in plain words, for Settings. */
  adds: string[];
}

export const PACKS: PackInfo[] = PACK_DEFS.map((p) => ({
  id: p.id,
  family: p.family,
  label: p.label,
  blurb: p.blurb,
  icon: p.icon,
  kinds: p.kinds.map((k) => storedKind(p, k)),
  adds: p.adds,
}));

export function packDef(id: string): PackDef | undefined {
  return PACK_DEFS.find((p) => p.id === id);
}

/** A kind written pack.kind (freelance.invoice), the shape the backend accepts for pack kinds. */
export function isPackKind(kind: string): boolean {
  return /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/.test(kind);
}

/** The pack and kind definition behind a stored kind, if a pack defines it. */
export function kindDefOf(kind: string): { pack: PackDef; kind: KindDef; dataKey: string } | undefined {
  for (const pack of PACK_DEFS) {
    for (const k of pack.kinds) if (storedKind(pack, k) === kind) return { pack, kind: k, dataKey: dataKeyOf(k) };
  }
  return undefined;
}

/** Settings key holding the list of enabled pack ids. */
export const PACKS_KEY = "packs.enabled";
/** Settings key set once the person has been asked what they use Worlds for. */
export const PACKS_ASKED_KEY = "packs.asked";

export function enabledPacks(settings: Record<string, unknown>): Set<PackId> {
  const v = settings[PACKS_KEY];
  return new Set(Array.isArray(v) ? (v.filter((x) => PACKS.some((p) => p.id === x)) as PackId[]) : []);
}

/** Kinds that belong to a pack that is currently off. */
export function hiddenKindsFor(settings: Record<string, unknown>): Set<string> {
  const on = enabledPacks(settings);
  return new Set(PACKS.filter((p) => !on.has(p.id)).flatMap((p) => p.kinds));
}

/** Which pack owns a kind, if any. */
export function packOfKind(kind: string): PackInfo | undefined {
  return PACKS.find((p) => p.kinds.includes(kind));
}

// Every pack starts off, so pack kinds are hidden until settings say otherwise.
let hidden = hiddenKindsFor({});

/** Called by the store whenever settings change. */
export function syncPackSettings(settings: Record<string, unknown>) {
  hidden = hiddenKindsFor(settings);
}

/**
 * True when this kind belongs to a pack that is off. A pack kind no pack
 * defines any more (made by a newer Worlds, or a pack that was removed) is
 * kept but not shown.
 */
export function isKindHidden(kind: string): boolean {
  return hidden.has(kind) || (isPackKind(kind) && !kindDefOf(kind));
}

/** True when this resource should not be shown at all right now. */
export function isHidden(p: Pick<PageMeta, "kind">): boolean {
  return isKindHidden(p.kind);
}
