/** A pack kind as a table: one row per item, its fields as columns, sorted by a column, with totals. */
import { useMemo, useState } from "react";
import type { PageMeta } from "../../lib/types";
import { pageTitle, useStore } from "../../state/store";
import { Icon } from "../../ui/Icon";
import type { KindDef } from "../definition";
import { compareField, formatField, listFields } from "../fields";
import { itemData } from "../items";
import { averageField, sumField } from "../rules";
import { useTitleOf } from "./links";

export function PackTable({ kind, items, columns, totals, averages }: { kind: KindDef; items: PageMeta[]; columns?: string[]; totals?: string[]; averages?: string[] }) {
  const openPage = useStore((s) => s.openPage);
  const titleOf = useTitleOf();
  const fields = listFields(kind, columns);
  const first = kind.dateField ?? null;
  const [sort, setSort] = useState<{ id: string | null; dir: 1 | -1 }>({ id: first, dir: 1 });
  const rows = useMemo(() => {
    const field = fields.find((f) => f.id === sort.id);
    const list = [...items];
    // Links sort by the linked item's title, not its id.
    const key = (p: PageMeta) => (field?.type === "link" ? titleOf(String(itemData(p)[field.id] ?? "")) || null : itemData(p)[field!.id]);
    if (field) list.sort((a, b) => sort.dir * compareField(field, key(a), key(b)));
    else list.sort((a, b) => sort.dir * pageTitle(a).localeCompare(pageTitle(b)));
    return list;
  }, [items, fields, sort, titleOf]);
  const sums = totals?.length ? fields.map((f) => (totals.includes(f.id) ? formatField(f, sumField(items, f.id)) : null)) : null;
  const means = averages?.length ? fields.map((f) => (averages.includes(f.id) ? formatField(f, averageField(items, f.id)) : null)) : null;
  const by = (id: string | null) => setSort((s) => (s.id === id ? { id, dir: s.dir === 1 ? -1 : 1 } : { id, dir: 1 }));
  const ariaSort = (id: string | null) => (sort.id === id ? (sort.dir === 1 ? "ascending" : "descending") : undefined);
  const arrow = (id: string | null) => (sort.id === id ? <Icon name="chevronDown" size={11} className={sort.dir === 1 ? "pk-asc" : ""} /> : null);

  return (
    <div className="pk-table-wrap">
      <table className="pk-table">
        <thead>
          <tr>
            <th aria-sort={ariaSort(null)}>
              <button type="button" className="pk-sort" onClick={() => by(null)}>
                {kind.label} {arrow(null)}
              </button>
            </th>
            {fields.map((f) => (
              <th key={f.id} className={`pk-col-${f.type}`} aria-sort={ariaSort(f.id)}>
                <button type="button" className="pk-sort" onClick={() => by(f.id)}>
                  {f.label} {arrow(f.id)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const data = itemData(p);
            const done = kind.doneField ? data[kind.doneField] === true : false;
            return (
              <tr key={p.id} className={done ? "is-done" : ""} tabIndex={0} onClick={(e) => openPage(p.id, e.ctrlKey ? "tab" : "current")} onKeyDown={(e) => e.key === "Enter" && openPage(p.id)}>
                <td className="pk-title bidi">{pageTitle(p)}</td>
                {fields.map((f) => (
                  <td key={f.id} className={`pk-col-${f.type}`}>
                    {f.type === "checkbox" ? (data[f.id] === true ? <Icon name="check" size={13} /> : null) : formatField(f, data[f.id], undefined, titleOf)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {(sums || means) && (
          <tfoot>
            {sums && <FootRow label="Total" values={sums} types={fields.map((f) => f.type)} />}
            {means && <FootRow label="Average" values={means} types={fields.map((f) => f.type)} />}
          </tfoot>
        )}
      </table>
    </div>
  );
}

function FootRow({ label, values, types }: { label: string; values: (string | null)[]; types: string[] }) {
  return (
    <tr>
      <th scope="row" className="pk-total-label">
        {label}
      </th>
      {values.map((v, i) => (
        <td key={i} className={`pk-col-${types[i]}`}>
          {v}
        </td>
      ))}
    </tr>
  );
}
