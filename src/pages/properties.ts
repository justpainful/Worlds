import type { PageMeta } from "../lib/types";

/** Page properties: typed fields under the title, stored in page metadata. */
export type PropType = "status" | "select" | "tags" | "date" | "number" | "checkbox" | "url" | "text";

export interface PropOption {
  name: string;
  color: PropColor;
}

export type PropColor = "gray" | "blue" | "green" | "yellow" | "orange" | "red" | "purple" | "pink";

export interface Property {
  id: string;
  name: string;
  type: PropType;
  value: string | number | boolean | string[] | null;
  options?: PropOption[];
}

export const PROP_TYPES: { id: PropType; label: string; icon: string }[] = [
  { id: "status", label: "Status", icon: "success" },
  { id: "select", label: "Select", icon: "chevronDown" },
  { id: "tags", label: "Tags", icon: "channel" },
  { id: "date", label: "Date", icon: "calendar" },
  { id: "number", label: "Number", icon: "numberedList" },
  { id: "checkbox", label: "Checkbox", icon: "check" },
  { id: "url", label: "Link", icon: "link" },
  { id: "text", label: "Text", icon: "text" },
];

export const STATUS_OPTIONS: PropOption[] = [
  { name: "Not started", color: "gray" },
  { name: "In progress", color: "blue" },
  { name: "Done", color: "green" },
];

export const PROP_COLORS: Record<PropColor, string> = {
  gray: "142, 142, 150",
  blue: "88, 156, 255",
  green: "61, 200, 120",
  yellow: "240, 196, 64",
  orange: "255, 150, 72",
  red: "255, 99, 99",
  purple: "170, 128, 255",
  pink: "245, 112, 180",
};

const COLOR_ORDER: PropColor[] = ["blue", "green", "yellow", "orange", "red", "purple", "pink", "gray"];
export const nextColor = (used: number): PropColor => COLOR_ORDER[used % COLOR_ORDER.length];

export const newPropId = () => `p${Math.random().toString(36).slice(2, 9)}`;

export function newProperty(type: PropType, name?: string): Property {
  const label = name ?? PROP_TYPES.find((t) => t.id === type)?.label ?? "Property";
  return {
    id: newPropId(),
    name: label,
    type,
    value: type === "checkbox" ? false : type === "tags" ? [] : type === "status" ? "Not started" : null,
    options: type === "status" ? STATUS_OPTIONS.map((o) => ({ ...o })) : type === "select" || type === "tags" ? [] : undefined,
  };
}

export function propsOf(meta: Pick<PageMeta, "properties"> | null | undefined): Property[] {
  const p = meta?.properties;
  return Array.isArray(p) ? (p as Property[]) : [];
}

export function propByName(meta: Pick<PageMeta, "properties">, name: string): Property | undefined {
  const n = name.toLowerCase();
  return propsOf(meta).find((p) => p.name.toLowerCase() === n);
}

/** Plain text for search, sorting and the table view. */
export function propText(p: Property | undefined): string {
  if (!p || p.value === null || p.value === undefined) return "";
  if (Array.isArray(p.value)) return p.value.join(", ");
  if (typeof p.value === "boolean") return p.value ? "Yes" : "No";
  if (p.type === "date" && typeof p.value === "string") {
    const d = new Date(p.value);
    return Number.isNaN(d.getTime()) ? p.value : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  return String(p.value);
}

export function optionColor(p: Property | undefined, name: string): string {
  const o = p?.options?.find((x) => x.name === name);
  return PROP_COLORS[o?.color ?? "gray"];
}
