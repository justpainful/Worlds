/**
 * Field values for pack items: how each field type is shown, read back from
 * what a person typed, started for a new item and sorted. Pure, so the views
 * and tests share one behaviour.
 */
import type { FieldDef, KindDef } from "./definition";

export type ItemData = Record<string, unknown>;

/** The Western digits of a number someone typed with an Arabic keyboard. */
function westernDigits(s: string): string {
  return s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\u066B/g, ".").replace(/[\u066C,]/g, "");
}

/** A number from typed text, or null when it is not one. */
export function parseNumber(text: string): number | null {
  const t = westernDigits(text.trim());
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The stored value for what was typed into a field. */
export function parseField(field: FieldDef, text: string): unknown {
  switch (field.type) {
    case "number":
    case "money":
      return parseNumber(text);
    case "checkbox":
      return text === "true";
    case "date": {
      const t = westernDigits(text.trim());
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
    }
    case "time": {
      const t = westernDigits(text.trim());
      return /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, "0") : null;
    }
    case "choice":
    case "stage":
      return field.options?.some((o) => o.id === text) ? text : null;
    default:
      return text;
  }
}

/** What a field shows in a list, card or table cell. Empty when there is nothing. */
export function formatField(field: FieldDef, value: unknown, locale?: string): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "money": {
      if (typeof value !== "number") return "";
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: field.currency ?? "SAR", maximumFractionDigits: 2 }).format(value);
      } catch {
        return `${value} ${field.currency ?? "SAR"}`;
      }
    }
    case "number":
      return typeof value === "number" ? new Intl.NumberFormat(locale).format(value) : "";
    case "checkbox":
      return value === true ? "✓" : "";
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
      const [y, m, d] = value.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
    }
    case "choice":
    case "stage":
      return field.options?.find((o) => o.id === value)?.label ?? "";
    default:
      return String(value);
  }
}

/** The data a new item of this kind starts with. */
export function initialData(kind: KindDef): ItemData {
  const out: ItemData = {};
  for (const f of kind.fields) {
    if (f.initial !== undefined) out[f.id] = f.initial;
    else if (f.type === "checkbox") out[f.id] = false;
    else if (f.type === "stage" && f.options?.length) out[f.id] = f.options[0].id;
  }
  return out;
}

/** Order two items by a field: empty values last, stages and choices by their order. */
export function compareField(field: FieldDef, a: unknown, b: unknown): number {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  if (field.type === "stage" || field.type === "choice") {
    const at = (v: unknown) => field.options?.findIndex((o) => o.id === v) ?? -1;
    return at(a) - at(b);
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

/** The fields a list or board shows (not the ones kept for the item page). */
export function listFields(kind: KindDef, columns?: string[]): FieldDef[] {
  if (columns) return columns.map((id) => kind.fields.find((f) => f.id === id)).filter((f): f is FieldDef => !!f);
  return kind.fields.filter((f) => !f.detailOnly);
}
