/**
 * Calendar and timeline views for collections. Both place pages by a date
 * property; the timeline can also stretch each page to an end date.
 */
import { useMemo, useState, type DragEvent } from "react";
import type { PageMeta } from "../../lib/types";
import { pageTitle } from "../../state/store";
import { Icon } from "../../ui/Icon";
import { PageIcon } from "../../ui/misc";
import { uiLanguage, tr } from "../../i18n/ui";
import { propByName, optionColor, propText } from "../../pages/properties";

const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const locale = () => (uiLanguage() === "ar" ? "ar" : undefined);

export function dateOf(p: PageMeta, name: string): Date | null {
  return parse(propByName(p, name)?.value);
}

interface Props {
  rows: PageMeta[];
  dateBy: string;
  endBy: string;
  editable: boolean;
  colorBy: string;
  open: (e: React.MouseEvent, id: string) => void;
  /** Set a page's date (and end date) after a drag. */
  move: (page: PageMeta, start: string, end: string | null) => void;
  create: (date: string) => void;
}

function tint(p: PageMeta, colorBy: string) {
  const prop = propByName(p, colorBy);
  const v = propText(prop);
  return v ? optionColor(prop, v) : "var(--accent-rgb)";
}

export function CalendarView({ rows, dateBy, editable, colorBy, open, move, create }: Props) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [over, setOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const firstDay = 6 - (uiLanguage() === "ar" ? 0 : 6); // Saturday in Arabic, Sunday otherwise
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() - firstDay + 7) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month, firstDay]);
  const byDay = useMemo(() => {
    const m = new Map<string, PageMeta[]>();
    for (const p of rows) {
      const d = dateOf(p, dateBy);
      if (!d) continue;
      const k = iso(d);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [rows, dateBy]);
  const undated = rows.filter((p) => !dateOf(p, dateBy)).length;
  const today = iso(new Date());
  const weekdays = days.slice(0, 7).map((d) => d.toLocaleDateString(locale(), { weekday: "short" }));

  return (
    <div className="col-cal">
      <div className="col-cal-head">
        <button className="col-btn" aria-label={tr("Previous month")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <Icon name="back" size={15} />
        </button>
        <span className="col-cal-title">{month.toLocaleDateString(locale(), { month: "long", year: "numeric" })}</span>
        <button className="col-btn" aria-label={tr("Next month")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <Icon name="forward" size={15} />
        </button>
        <button className="col-cal-today" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          {tr("Today")}
        </button>
        <span className="grow" />
        <span className="col-cal-note">
          {tr("By")} {dateBy}
          {undated ? ` · ${undated} ${tr("without a date")}` : ""}
        </span>
      </div>
      <div className="col-cal-grid">
        {weekdays.map((w, i) => (
          <div key={i} className="col-cal-wd">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const k = iso(d);
          const list = byDay.get(k) ?? [];
          return (
            <div
              key={k}
              className={`col-cal-day ${d.getMonth() !== month.getMonth() ? "is-out" : ""} ${k === today ? "is-today" : ""} ${over === k ? "is-over" : ""}`}
              onDragOver={(e: DragEvent) => {
                if (!dragId) return;
                e.preventDefault();
                setOver(k);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                setOver(null);
                const p = rows.find((r) => r.id === dragId);
                setDragId(null);
                if (p) move(p, k, null);
              }}
              onDoubleClick={() => editable && create(k)}
            >
              <span className="col-cal-num">{d.getDate()}</span>
              {list.slice(0, 4).map((p) => (
                <button
                  key={p.id}
                  className="col-cal-item"
                  style={{ ["--chip" as string]: tint(p, colorBy) }}
                  draggable={editable}
                  onDragStart={(e) => {
                    setDragId(p.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={(e) => open(e, p.id)}
                >
                  <span className="bidi">{pageTitle(p)}</span>
                </button>
              ))}
              {list.length > 4 && <span className="col-cal-more">+{list.length - 4}</span>}
              {editable && (
                <button className="col-cal-add" aria-label={tr("New page on this day")} onClick={() => create(k)}>
                  <Icon name="add" size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SCALES = { week: 56, month: 26, quarter: 9 } as const;

export function TimelineView({ rows, dateBy, endBy, editable, colorBy, open, move }: Props) {
  const [scale, setScale] = useState<keyof typeof SCALES>("month");
  const px = SCALES[scale];
  const dated = rows
    .map((p) => {
      const s = dateOf(p, dateBy);
      const e = endBy ? dateOf(p, endBy) : null;
      return s ? { p, s, e: e && e >= s ? e : s } : null;
    })
    .filter((x): x is { p: PageMeta; s: Date; e: Date } => !!x)
    .sort((a, b) => a.s.getTime() - b.s.getTime());
  const now = new Date();
  const first = dated.length ? new Date(Math.min(dated[0].s.getTime(), now.getTime())) : now;
  const last = dated.length ? new Date(Math.max(...dated.map((x) => x.e.getTime()), now.getTime())) : new Date(now.getTime() + 30 * DAY);
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - 7);
  const span = Math.max(45, Math.ceil((last.getTime() - start.getTime()) / DAY) + 21);
  const x = (d: Date) => Math.round((d.getTime() - start.getTime()) / DAY) * px;
  const months = useMemo(() => {
    const out: { label: string; left: number }[] = [];
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d.getTime() < start.getTime() + span * DAY) {
      out.push({ label: d.toLocaleDateString(locale(), { month: "short", year: scale === "quarter" ? "2-digit" : undefined }), left: Math.max(0, x(d)) });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start.getTime(), span, px]);
  const [drag, setDrag] = useState<null | { id: string; mode: "move" | "end"; x0: number; dx: number }>(null);

  const onDown = (e: React.PointerEvent, id: string, mode: "move" | "end") => {
    if (!editable) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, mode, x0: e.clientX, dx: 0 });
  };
  const onMove = (e: React.PointerEvent) => drag && setDrag({ ...drag, dx: e.clientX - drag.x0 });
  const onUp = () => {
    if (!drag) return;
    const item = dated.find((d) => d.p.id === drag.id);
    const days = Math.round(drag.dx / px);
    setDrag(null);
    if (!item || !days) return;
    if (drag.mode === "move") {
      const s = new Date(item.s.getTime() + days * DAY);
      const e = new Date(item.e.getTime() + days * DAY);
      move(item.p, iso(s), endBy ? iso(e) : null);
    } else if (endBy) {
      const e = new Date(Math.max(item.s.getTime(), item.e.getTime() + days * DAY));
      move(item.p, iso(item.s), iso(e));
    }
  };

  return (
    <div className="col-tl">
      <div className="col-tl-head">
        <span className="col-cal-note">
          {tr("By")} {dateBy}
          {endBy ? ` ${tr("to")} ${endBy}` : ""}
        </span>
        <span className="grow" />
        <div className="col-tl-scale" role="tablist">
          {(Object.keys(SCALES) as (keyof typeof SCALES)[]).map((k) => (
            <button key={k} role="tab" aria-selected={scale === k} className={scale === k ? "is-on" : ""} onClick={() => setScale(k)}>
              {tr(k === "week" ? "Days" : k === "month" ? "Weeks" : "Months")}
            </button>
          ))}
        </div>
      </div>
      <div className="col-tl-scroll" dir="ltr" onPointerMove={onMove} onPointerUp={onUp}>
        <div className="col-tl-track" style={{ width: span * px }}>
          <div className="col-tl-months">
            {months.map((m, i) => (
              <span key={i} style={{ left: m.left }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="col-tl-today" style={{ left: x(new Date(now.getFullYear(), now.getMonth(), now.getDate())) }} />
          {dated.map(({ p, s, e }) => {
            const shift = drag?.id === p.id ? drag.dx : 0;
            const left = x(s) + (drag?.id === p.id && drag.mode === "move" ? shift : 0);
            const width = Math.max(px, x(e) - x(s) + px) + (drag?.id === p.id && drag.mode === "end" ? shift : 0);
            return (
              <div key={p.id} className="col-tl-row">
                <div
                  className={`col-tl-bar ${drag?.id === p.id ? "is-dragging" : ""}`}
                  style={{ left, width: Math.max(px, width), ["--chip" as string]: tint(p, colorBy) }}
                  onPointerDown={(ev) => onDown(ev, p.id, "move")}
                  onClick={(ev) => !drag && open(ev, p.id)}
                >
                  <PageIcon icon={p.icon} size={13} />
                  <span className="bidi" dir="auto">
                    {pageTitle(p)}
                  </span>
                  {editable && endBy && <span className="col-tl-end" onPointerDown={(ev) => onDown(ev, p.id, "end")} />}
                </div>
              </div>
            );
          })}
          {!dated.length && <div className="col-empty">{tr("No pages have a date yet. Give a page a date to see it here.")}</div>}
        </div>
      </div>
    </div>
  );
}
