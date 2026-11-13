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
  | "phone";

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

export interface PackDef {
  id: string;
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
}

/** The stored kind of a pack kind. */
export function storedKind(pack: PackDef, kind: KindDef): ResourceKind {
  return (kind.kind ?? `${pack.id}.${kind.id}`) as ResourceKind;
}

/** The metadata key a kind's data lives under. */
export function dataKeyOf(kind: KindDef): string {
  return kind.dataKey ?? (kind.kind ? kind.kind : "item");
}
