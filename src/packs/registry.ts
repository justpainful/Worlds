/**
 * Packs: optional sets of features a person turns on for what they use Worlds
 * for. Worlds itself stays general; a pack adds kinds, sidebar entries, Home
 * sections and commands. While a pack is off, nothing of it shows anywhere,
 * and anything made with it is kept, hidden, and comes back when it is turned
 * on again. See docs/PACKS.md.
 *
 * This module has no store dependency so the store's own selectors can use it.
 * Hooks and actions live in ./packs.ts.
 */
import type { PageMeta, ResourceKind } from "../lib/types";

export type PackId = "study";

export interface PackInfo {
  id: PackId;
  label: string;
  /** One sentence for the Settings row and the chooser. */
  blurb: string;
  /** Product icon (src/assets/product-icons). */
  icon: string;
  /** Kinds that exist only while this pack is on. */
  kinds: ResourceKind[];
  /** What it adds, in plain words, for Settings. */
  adds: string[];
}

export const PACKS: PackInfo[] = [
  {
    id: "study",
    label: "Study",
    blurb: "Subjects, a class timetable, assignments, exams and lessons, for school or university.",
    icon: "graduation",
    kinds: ["subject", "lesson", "assignment", "exam", "requirement"],
    adds: [
      "Subjects with teachers, rooms and colours",
      "A weekly class timetable in Calendar",
      "Assignments, exams and things to bring",
      "Lesson notes filed under each subject",
      "A study summary on Home",
    ],
  },
];

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
  return PACKS.find((p) => (p.kinds as string[]).includes(kind));
}

// Every pack starts off, so pack kinds are hidden until settings say otherwise.
let hidden = hiddenKindsFor({});

/** Called by the store whenever settings change. */
export function syncPackSettings(settings: Record<string, unknown>) {
  hidden = hiddenKindsFor(settings);
}

/** True when this kind belongs to a pack that is off. */
export function isKindHidden(kind: string): boolean {
  return hidden.has(kind);
}

/** True when this resource should not be shown at all right now. */
export function isHidden(p: Pick<PageMeta, "kind">): boolean {
  return hidden.has(p.kind);
}
