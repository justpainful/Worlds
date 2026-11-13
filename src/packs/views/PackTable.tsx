/** A pack kind as a table: one row per item, its fields as columns, sorted by a column. */
import { useMemo, useState } from "react";
import type { PageMeta } from "../../lib/types";
import { pageTitle, useStore } from "../../state/store";
import { Icon } from "../../ui/Icon";
import type { KindDef } from "../definition";
import { compareField, formatField, listFields } from "../fields";
import { itemData } from "../items";

export function PackTable({ kind, items, columns }: { kind: KindDef; items: PageMeta[]; columns?: string[] }) {
  const openPage = useStore((s) => s.openPage);
  const fields = listFields(kind, columns);
  const first = kind.dateField ?? null;
  const [sort, setSort] = useState<{ id: string | null; dir: 1 | -1 }>({ id: first, dir: 1 });
  const rows = useMemo(() => {
    const field = fields.find((f) => f.id === sort.id);
    const list = [...items];
    if (field) list.sort((a, b) => sort.dir * compareField(field, itemData(a)[field.id], itemData(b)[field.id]));
    else list.sort((a, b) => sort.dir * pageTitle(a).localeCompare(pageTitle(b)));
    return list;
  }, [items, fields, sort]);
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
                    {formatField(f, data[f.id])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
