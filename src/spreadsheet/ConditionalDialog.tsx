/**
 * Highlight cells: conditional formatting for the active sheet. A rule gives
 * cells in a range a colour when their value passes a test; the first rule
 * that matches wins (see conditionalStyle in engine.ts).
 */
import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Select } from "../ui/Select";
import { parseCellRef, type ConditionalRule } from "./engine";

type Op = ConditionalRule["op"];

const OPS: { value: Op; label: string }[] = [
  { value: "gt", label: "Greater than" },
  { value: "lt", label: "Less than" },
  { value: "between", label: "Between" },
  { value: "eq", label: "Equal to" },
  { value: "contains", label: "Text contains" },
  { value: "notEmpty", label: "Is not empty" },
];

/** Fills that read in both themes, each with white text. */
export const HIGHLIGHTS: { name: string; bg: string; color: string }[] = [
  { name: "Green", bg: "#2f855a", color: "#ffffff" },
  { name: "Amber", bg: "#b7791f", color: "#ffffff" },
  { name: "Red", bg: "#c53030", color: "#ffffff" },
  { name: "Blue", bg: "#2b6cb0", color: "#ffffff" },
];

/** A1 or A1:B9, with both ends valid. */
export function validRange(range: string): boolean {
  const parts = range.trim().split(":");
  return parts.length >= 1 && parts.length <= 2 && parts.every((p) => !!parseCellRef(p) && !p.includes("!"));
}

export function ruleSummary(rule: ConditionalRule): string {
  const op = OPS.find((o) => o.value === rule.op)?.label ?? rule.op;
  if (rule.op === "notEmpty") return op;
  if (rule.op === "between") return `${op} ${rule.value} and ${rule.value2 ?? ""}`;
  return `${op} ${rule.value}`;
}

export function ConditionalDialog({
  rules,
  selection,
  onChange,
  onClose,
}: {
  rules: ConditionalRule[];
  /** The selected range, offered as the rule's range. */
  selection: string;
  onChange: (rules: ConditionalRule[]) => void;
  onClose: () => void;
}) {
  const [range, setRange] = useState(selection);
  const [op, setOp] = useState<Op>("gt");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [paint, setPaint] = useState(0);

  const needsValue = op !== "notEmpty";
  const ready = validRange(range) && (!needsValue || value.trim() !== "") && (op !== "between" || value2.trim() !== "");

  const add = () => {
    if (!ready) return;
    const { bg, color } = HIGHLIGHTS[paint];
    const rule: ConditionalRule = { id: `cr_${Date.now().toString(36)}`, range: range.trim().toUpperCase(), op, value: needsValue ? value.trim() : "", bg, color };
    if (op === "between") rule.value2 = value2.trim();
    onChange([...rules, rule]);
    setValue("");
    setValue2("");
  };

  return (
    <Modal onClose={onClose} title="Highlight cells" width={520}>
      <div className="cf-dialog">
        <p className="cf-lead">Colour cells in a range when their value passes a test. The first matching rule wins.</p>
        <div className="cf-grid">
          <label className="cf-field">
            <span>Range</span>
            <input className="field" dir="ltr" value={range} onChange={(e) => setRange(e.target.value)} placeholder="B2:F20" aria-invalid={!validRange(range)} />
          </label>
          <label className="cf-field">
            <span>When the value is</span>
            <Select value={op} options={OPS} onChange={setOp} label="When the value is" />
          </label>
          {needsValue && (
            <label className="cf-field">
              <span>{op === "contains" ? "Text" : "Value"}</span>
              <input className="field" dir="auto" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            </label>
          )}
          {op === "between" && (
            <label className="cf-field">
              <span>And</span>
              <input className="field" dir="auto" value={value2} onChange={(e) => setValue2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            </label>
          )}
        </div>
        <div className="cf-paints" role="radiogroup" aria-label="Colour">
          {HIGHLIGHTS.map((h, i) => (
            <button
              key={h.name}
              type="button"
              role="radio"
              aria-checked={paint === i}
              aria-label={h.name}
              data-tip={h.name}
              className={`cf-paint ${paint === i ? "is-on" : ""}`}
              style={{ background: h.bg, color: h.color }}
              onClick={() => setPaint(i)}
            >
              {paint === i ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
          <span className="grow" />
          <Button variant="tinted" icon="add" disabled={!ready} onClick={add}>
            Add rule
          </Button>
        </div>

        <div className="cf-rules">
          <div className="cf-rules-title">Rules on this sheet</div>
          {rules.length === 0 ? (
            <p className="cf-empty">No rules yet.</p>
          ) : (
            rules.map((r) => (
              <div key={r.id} className="cf-rule">
                <span className="cf-swatch" style={{ background: r.bg }} />
                <bdi dir="ltr" className="cf-range">{r.range}</bdi>
                <span className="cf-desc">{ruleSummary(r)}</span>
                <span className="grow" />
                <button type="button" className="icon-btn" aria-label="Remove rule" data-tip="Remove rule" onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
                  <Icon name="delete" size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
