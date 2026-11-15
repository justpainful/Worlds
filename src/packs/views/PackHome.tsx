/**
 * The Home section every pack gets from its definition: its figures, what
 * needs attention, and what is coming up in the next two weeks.
 */
import { useMemo } from "react";
import { pageTitle, useStore } from "../../state/store";
import { Icon } from "../../ui/Icon";
import type { PackDef } from "../definition";
import { formatField } from "../fields";
import { alertItems, statValue, todayIso, upcoming } from "../rules";

export function PackHome({ pack }: { pack: PackDef }) {
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const today = todayIso();
  const stats = useMemo(
    () =>
      (pack.stats ?? []).map((st) => {
        const value = statValue(pages, pack, st, today);
        const field = st.field ? pack.kinds.find((k) => k.id === st.kind)?.fields.find((f) => f.id === st.field) : undefined;
        const text = value === null ? "" : field && st.agg !== "count" ? formatField(field, value) : new Intl.NumberFormat().format(value);
        return { label: st.label, text: text || "0" };
      }),
    [pages, pack, today],
  );
  const alerts = useMemo(
    () => (pack.alerts ?? []).map((a) => ({ label: a.label, items: alertItems(pages, pack, a, today) })).filter((a) => a.items.length),
    [pages, pack, today],
  );
  const soon = useMemo(() => upcoming(pages, pack, today).slice(0, 6), [pages, pack, today]);

  if (!stats.length && !alerts.length && !soon.length) return <p className="pk-none">Nothing to show yet. Items you add appear here.</p>;
  return (
    <div className="pk-home">
      {stats.length > 0 && (
        <div className="pk-stats">
          {stats.map((s) => (
            <div key={s.label} className="pk-stat">
              <span className="pk-stat-value bidi">{s.text}</span>
              <span className="pk-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}
      {alerts.map((a) => (
        <div key={a.label} className="pk-alert" role="status">
          <Icon name="warning" size={14} />
          <span className="pk-alert-label">{a.label}</span>
          <span className="pl-count">{a.items.length}</span>
          <span className="pk-alert-items">
            {a.items.slice(0, 3).map((p) => (
              <button key={p.id} type="button" className="link-btn bidi" onClick={(e) => openPage(p.id, e.ctrlKey ? "tab" : "current")}>
                {pageTitle(p)}
              </button>
            ))}
          </span>
        </div>
      ))}
      {soon.length > 0 && (
        <ul className="pk-soon">
          {soon.map(({ page, kind, date }) => (
            <li key={page.id}>
              <button type="button" className="pk-soon-row" onClick={(e) => openPage(page.id, e.ctrlKey ? "tab" : "current")}>
                <span className="pk-soon-date">{formatField({ id: "date", label: "", type: "date" }, date)}</span>
                <span className="pk-soon-title bidi">{pageTitle(page)}</span>
                <span className="pk-soon-kind">{kind.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
