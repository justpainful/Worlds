/** Edits one field of a pack item, with the control its type calls for. */
import { BlurInput } from "../../planning/ui";
import { Select } from "../../ui/Select";
import type { FieldDef } from "../definition";
import { parseField, parseNumber } from "../fields";

export function FieldInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
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
    case "url":
    case "email":
    case "phone":
      return <BlurInput type={field.type === "phone" ? "tel" : field.type} value={text} placeholder={field.placeholder} onCommit={(v) => onChange(v.trim())} />;
    default:
      return <BlurInput value={text} placeholder={field.placeholder} onCommit={(v) => onChange(v)} />;
  }
}
