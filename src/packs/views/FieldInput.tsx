/** Edits one field of a pack item, with the control its type calls for. */
import { useMemo } from "react";
import { BlurInput } from "../../planning/ui";
import { pageTitle, useStore } from "../../state/store";
import { Select } from "../../ui/Select";
import type { FieldDef, PackDef } from "../definition";
import { parseField, parseNumber } from "../fields";
import { packItems } from "../rules";

export function FieldInput({ field, value, onChange, pack }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; pack?: PackDef }) {
  const text = value === null || value === undefined ? "" : String(value);
  switch (field.type) {
    case "longText":
      return <BlurInput multiline value={text} placeholder={field.placeholder} onCommit={(v) => onChange(v)} />;
    case "number":
    case "money":
      // A text box, not type=number: that one refuses digits typed with an Arabic keyboard.
      return (
        <input
          className="field"
          inputMode="decimal"
          key={text}
          defaultValue={typeof value === "number" ? String(value) : ""}
          placeholder={field.placeholder ?? (field.type === "money" ? (field.currency ?? "SAR") : undefined)}
          aria-label={field.label}
          onBlur={(e) => {
            const n = parseNumber(e.target.value);
            if (n !== value) onChange(n);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      );
    case "date":
    case "time":
      return <input className="field" type={field.type} value={text} aria-label={field.label} onChange={(e) => onChange(parseField(field, e.target.value))} />;
    case "checkbox":
      return <input type="checkbox" className="pk-check" checked={value === true} aria-label={field.label} onChange={(e) => onChange(e.target.checked)} />;
    case "choice":
    case "stage":
      return (
        <Select
          value={text}
          label={field.label}
          options={[...(field.type === "choice" ? [{ value: "", label: "None" }] : []), ...(field.options ?? []).map((o) => ({ value: o.id, label: o.label }))]}
          onChange={(v) => onChange(v || null)}
        />
      );
    case "link":
      return pack && field.to ? <LinkInput pack={pack} field={field} value={text} onChange={onChange} /> : null;
    case "url":
    case "email":
    case "phone":
      return <BlurInput type={field.type === "phone" ? "tel" : field.type} value={text} placeholder={field.placeholder} onCommit={(v) => onChange(v.trim())} />;
    default:
      return <BlurInput value={text} placeholder={field.placeholder} onCommit={(v) => onChange(v)} />;
  }
}

/** Picks another item of the pack, such as the client of an invoice. */
function LinkInput({ pack, field, value, onChange }: { pack: PackDef; field: FieldDef; value: string; onChange: (v: unknown) => void }) {
  const pages = useStore((s) => s.pages);
  const options = useMemo(
    () =>
      packItems(pages, pack, field.to!)
        .map((p) => ({ value: p.id, label: pageTitle(p) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [pages, pack, field.to],
  );
  // A linked item that was deleted still shows, so the field never looks silently empty.
  const gone = value && !options.some((o) => o.value === value) ? [{ value, label: pages[value] ? pageTitle(pages[value]) : "Deleted item" }] : [];
  return <Select value={value} label={field.label} options={[{ value: "", label: "None" }, ...gone, ...options]} onChange={(v) => onChange(v || null)} />;
}
