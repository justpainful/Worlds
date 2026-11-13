/**
 * The shape of a pack (docs/PACKS.md). A pack is data the engine reads, not a
 * feature built by hand: its kinds and their fields, the views it shows, its
 * place in the sidebar, Home and commands, and its roles. Labels are written
 * in English and translated by the interface dictionary like the rest of
 * Worlds, so every pack is Arabic and English from the start.
 */
import type { ResourceKind } from "../lib/types";
import type { IconName } from "../ui/Icon";

/** A field's type decides how it is shown, edited, sorted and searched. */
export type FieldType =
  | "text" // one line
  | "longText" // several lines
  | "number"
  | "money" // an amount; the currency comes from the field or the workspace
  | "date" // YYYY-MM-DD
  | "time" // HH:MM
  | "checkbox"
  | "choice" // one of the options
  | "stage" // one of the options, in order; a board groups by it
  | "url"
  | "email"
  | "phone"
  | "link"; // another item of the same pack, by page id (the kind is in `to`)

export interface FieldOption {
  id: string;
  label: string;
  /** A colour token for chips and board lanes (blue, green, ...). */
  color?: string;
}

export interface FieldDef {
  /** The key in the item's data. */
  id: string;
  label: string;
  type: FieldType;
  /** For choice and stage. */
  options?: FieldOption[];
  /** For money: ISO 4217 code. SAR when not given. */
  currency?: string;
  /** Shown in an empty field. */
  placeholder?: string;
  /** Value a new item starts with. */
  initial?: unknown;
  /** Hidden from lists and boards, shown on the item. */
  detailOnly?: boolean;
  /** For link: the kind id (in the same pack) it points to. */
  to?: string;
  /**
   * Worked out from other number fields whenever one of them changes: their
   * sum, times `factor` (VAT is the subtotal times 0.15). Still editable.
   */
  compute?: { of: string[]; factor?: number };
  /**
   * A running reference number for new items: the prefix, then one more than
   * the highest number already used (OUT-0007 after OUT-0006).
   */
  sequence?: string;
}

export interface KindDef {
  /** Short id inside the pack: "invoice". */
  id: string;
  /**
   * The stored kind. New packs leave it out and get `<pack>.<id>`
   * (freelance.invoice), stored by the backend under metadata.item.
   * Study keeps its existing kinds and data keys, so it sets both.
   */
  kind?: string;
  dataKey?: string;
  label: string;
  plural: string;
  /** Product icon (src/assets/product-icons). */
  icon: string;
  blurb: string;
  fields: FieldDef[];
  /** The field placed on the calendar, if any. */
  dateField?: string;
  /** The stage or choice field a board groups by by default. */
  stageField?: string;
  /** A field that marks the item done (a checkbox); lists strike it through. */
  doneField?: string;
}

/**
 * A test on one field of an item. All given parts must hold. Dates are compared
 * with today, so "overdue" and "within" follow the clock.
 */
export interface Condition {
  field: string;
  /** The value is one of these (choice, stage, or true/false for a checkbox). */
  in?: unknown[];
  /** The value is none of these. */
  notIn?: unknown[];
  /** The field is empty (true) or filled (false). */
  empty?: boolean;
  /** A date before today. */
  overdue?: boolean;
  /** A date from today up to this many days ahead. */
  within?: number;
  /** A date in the current week or month. */
  period?: "week" | "month";
  /** A number at or below this value, or at or below another field of the item. */
  atMost?: number | string;
  /**
   * Another item has the same value in this field and in each of these, such
   * as the same staff member at the same date and time: a double booking.
   */
  clashesOn?: string[];
}

/** A figure on Home: how many items match, or the sum of one field across them. */
export interface StatDef {
  label: string;
  kind: string;
  agg: "count" | "sum" | "average";
  /** For sum and average: a number or money field. */
  field?: string;
  where?: Condition[];
}

/** Items that need the person, listed on Home and above the pack's views while any match. */
export interface AlertDef {
  label: string;
  kind: string;
  where: Condition[];
}

/** A request the person can hand to Claude from the pack. */
export interface PromptDef {
  label: string;
  /** Sent in the person's language; Claude also sees the open item. */
  prompt: Bilingual;
}

/** Text written in both languages, for sample data that is content, not interface. */
export type Bilingual = string | { en: string; ar: string };

/** An item the pack can add to show how it works, in the person's language. */
export interface SampleDef {
  /** Lets other samples link to this one. */
  ref?: string;
  kind: string;
  title: Bilingual;
  /** Field values; text can be bilingual, links name another sample's ref. */
  data?: Record<string, unknown>;
}

/** Built from the shared blocks, or a component the pack brings itself. */
export type ViewType = "table" | "board" | "custom";

export interface ViewDef {
  id: string;
  label: string;
  icon: IconName;
  type: ViewType;
  /** The kind a table or board shows (the KindDef id). */
  kind?: string;
  /** For a board: the stage or choice field that makes its lanes. */
  groupBy?: string;
  /** For a table: the fields shown as columns, in order. All when left out. */
  columns?: string[];
  /** For custom: the name the component is registered under (src/packs/components.tsx). */
  component?: string;
  /** Only items that match every condition. */
  filter?: Condition[];
  /** For a table: number and money fields added up under the last row. */
  totals?: string[];
  /** For a table: number fields averaged under the last row. */
  averages?: string[];
}

export interface RoleDef {
  id: string;
  label: string;
  /** "all" sees every item; "assigned" only items assigned to them. */
  sees: "all" | "assigned";
  canEdit: boolean;
  /** Field ids this role never sees (profit, cost). */
  hiddenFields?: string[];
}

/** The seven families Settings and the chooser group packs by (docs/PACKS.md). */
export type FamilyId = "education" | "business" | "field" | "services" | "creative" | "community" | "personal";

export const FAMILIES: { id: FamilyId; label: string; icon: string }[] = [
  { id: "education", label: "Education and training", icon: "graduation" },
  { id: "business", label: "Work and business", icon: "briefcase" },
  { id: "field", label: "Field work", icon: "engineering" },
  { id: "services", label: "Services and hospitality", icon: "dallah" },
  { id: "creative", label: "Creative, tech and media", icon: "creative" },
  { id: "community", label: "Community", icon: "team" },
  { id: "personal", label: "Individuals", icon: "profile" },
];

export interface PackDef {
  id: string;
  family: FamilyId;
  label: string;
  /** One sentence for the Settings row and the chooser. */
  blurb: string;
  icon: string;
  /** What it adds, in plain words, for Settings. */
  adds: string[];
  kinds: KindDef[];
  views: ViewDef[];
  /** View ids shown in the sidebar, in order. The first opens with the pack. */
  sidebar: string[];
  /** A component registered for Home, if the pack has a section there. */
  home?: string;
  /** The link beside the Home section that opens the pack (Open when left out). */
  homeLink?: string;
  /** Kind ids offered in the New menu. */
  newMenu?: string[];
  /** Search words for its commands, in both languages. */
  keywords?: string;
  roles: RoleDef[];
  /** Figures for its Home section. */
  stats?: StatDef[];
  /** What needs attention, on Home and in the pack. */
  alerts?: AlertDef[];
  /** Requests for Claude, in its views and the command palette. */
  prompts?: PromptDef[];
  /** Example items, added on request from an empty view. */
  samples?: SampleDef[];
}

/** The stored kind of a pack kind. */
export function storedKind(pack: PackDef, kind: KindDef): ResourceKind {
  return (kind.kind ?? `${pack.id}.${kind.id}`) as ResourceKind;
}

/** The metadata key a kind's data lives under. */
export function dataKeyOf(kind: KindDef): string {
  return kind.dataKey ?? (kind.kind ? kind.kind : "item");
}
