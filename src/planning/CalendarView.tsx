/** Calendar: a week at a glance, or the agenda for the weeks ahead. */
import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { EmptyState, PageIcon } from "../ui/misc";
import { pageTitle } from "../state/store";
import { KIND_INFO } from "../resources/kinds";
import { createItem, toggleTask, updateData } from "./actions";
import { addDays, formatTime, occurrences, parseISODate, relDay, startOfWeek, today, type Occurrence } from "./model";
import { colorVar, itemMenu, QuickAdd } from "./ui";
import { useMenu } from "../ui/Menu";
import { uiLanguage } from "../i18n/ui";
import { hijriSpan, span } from "../i18n/locale";

type Mode = "week" | "agenda";

export function CalendarView() {
  const pages = useStore((s) => s.pages);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const mode = ((settings["calendar.mode"] as Mode) ?? "week") as Mode;
  const weekStart = Number(settings["calendar.weekStart"] ?? 0);
  const now = today();
  const [anchor, setAnchor] = useState(now);

  const from = mode === "week" ? startOfWeek(anchor, weekStart) : anchor;
  const to = mode === "week" ? addDays(from, 6) : addDays(anchor, 34);
  const occ = useMemo(() => occurrences(pages, from, to, { includeDone: true }), [pages, from, to]);
  const days = useMemo(() => Array.from({ length: mode === "week" ? 7 : 35 }, (_, i) => addDays(from, i)), [from, mode]);
  const byDay = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of occ) m.set(o.date, [...(m.get(o.date) ?? []), o]);
    return m;
  }, [occ]);

  const step = mode === "week" ? 7 : 35;
  // The weekend is Friday and Saturday in Saudi Arabia, Saturday and Sunday elsewhere.
  const weekend = uiLanguage() === "ar" ? [5, 6] : [6, 0];
  const title = (() => {
    const a = parseISODate(from), b = parseISODate(to);
    const sameMonth = a.getMonth() === b.getMonth();
    const month = a.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return sameMonth ? month : span(a.toLocaleDateString(undefined, { month: "short" }), b.toLocaleDateString(undefined, { month: "short", year: "numeric" }));
  })();

  const addOn = async (day: string) => {
    await createItem("event", { title: "", data: { date: day, start: "09:00", end: "10:00" }, open: "current" });
  };

  return (
    <div className="pl-view pl-calendar">
      <header className="pl-head">
        <div>
          <h1 className="pl-title">{title}</h1>
          <p className="pl-sub">{occ.filter((o) => o.date === now && !o.done).length || "Nothing"} today</p>
          {/* In Arabic the Hijri months of the shown days follow, as Saudi calendars print them. */}
          {uiLanguage() === "ar" && (
            <p className="pl-sub pl-hijri" translate="no">
              {hijriSpan(parseISODate(from), parseISODate(to))}
            </p>
          )}
        </div>
        <div className="pl-head-controls">
          <IconButton icon="back" label="Previous" onClick={() => setAnchor(addDays(anchor, -step))} />
          <Button variant="plain" size="compact" onClick={() => setAnchor(now)}>Today</Button>
          <IconButton icon="forward" label="Next" onClick={() => setAnchor(addDays(anchor, step))} />
          <Segmented value={mode} onChange={(v) => setSetting("calendar.mode", v)} label="View" options={[{ value: "week", label: "Week" }, { value: "agenda", label: "Agenda" }]} size="standard" />
        </div>
      </header>

      <QuickAdd
        placeholder="Add an event, like “Team sync thursday 10am”"
        onAdd={async (p) => {
          const date = p.due ?? (mode === "week" && (anchor < from || anchor > to) ? from : anchor);
          const start = p.time;
          const end = start ? `${String(Math.min(23, Number(start.slice(0, 2)) + 1)).padStart(2, "0")}:${start.slice(3)}` : null;
          await createItem("event", { title: p.title, data: { date, start, end, allDay: !start } });
          setAnchor(date);
        }}
      />

      {mode === "week" ? (
        <div className="cal-week">
          {days.map((day) => (
            <div key={day} className={`cal-day ${day === now ? "is-today" : ""} ${day < now ? "is-past" : ""} ${weekend.includes(parseISODate(day).getDay()) ? "is-weekend" : ""}`}>
              <div className="cal-day-head">
                <span className="cal-dow">{parseISODate(day).toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span className="cal-num">{parseISODate(day).getDate()}</span>
                <IconButton icon="add" label="Add event" className="cal-add" onClick={() => addOn(day)} />
              </div>
              <div className="cal-day-body">
                {(byDay.get(day) ?? []).map((o) => (
                  <Chip key={o.key} o={o} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : occ.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing in the next five weeks" text="Events, tasks with a date and, with the Study pack, classes and exams appear here." />
      ) : (
        <div className="cal-agenda">
          {days
            .filter((d) => byDay.has(d))
            .map((day) => (
              <section key={day} className={`cal-agenda-day ${day === now ? "is-today" : ""}`}>
                <h3 className="pl-group-head">
                  <span>{relDay(day)}</span>
                  <span className="pl-count">{parseISODate(day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                </h3>
                <div className="pl-list">
                  {byDay.get(day)!.map((o) => (
                    <Chip key={o.key} o={o} wide />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

/** One thing on the calendar. Tasks and work can be ticked right here. */
function Chip({ o, wide }: { o: Occurrence; wide?: boolean }) {
  const openPage = useStore((s) => s.openPage);
  const show = useMenu((s) => s.show);
  const color = colorVar(o.color);
  const tickable = o.kind === "task" || o.kind === "assignment" || o.kind === "requirement";
  const tick = () => {
    if (o.kind === "task") toggleTask(o.page);
    else if (o.kind === "assignment") updateData(o.page, "assignment", { submitted: !o.done, submittedAt: o.done ? null : Date.now() });
    else if (o.kind === "requirement") updateData(o.page, "requirement", { ready: !o.done });
  };
  return (
    <div
      className={`cal-chip kind-${o.kind} ${o.done ? "is-done" : ""} ${wide ? "is-wide" : ""}`}
      style={color ? ({ "--chip": color } as React.CSSProperties) : undefined}
      role="button"
      tabIndex={0}
      onClick={(e) => openPage(o.page.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
      onKeyDown={(e) => e.key === "Enter" && openPage(o.page.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (o.kind !== "event") show(e.clientX, e.clientY, itemMenu(o.page));
      }}
      data-tip={KIND_INFO[o.kind].label}
    >
      {tickable ? (
        <button type="button" role="checkbox" aria-checked={o.done} aria-label="Done" className={`pl-check pl-check-sm ${o.done ? "is-done" : ""}`} onClick={(e) => { e.stopPropagation(); tick(); }}>
          {o.done && <Icon name="check" size={10} />}
        </button>
      ) : o.kind === "exam" ? (
        <PageIcon icon="pi:medal" size={13} />
      ) : (
        <span className="cal-bar" />
      )}
      <span className="cal-chip-text">
        {o.start && <span className="cal-time">{formatTime(o.start)}</span>}
        <span className="cal-chip-title bidi">{pageTitle(o.page)}</span>
      </span>
    </div>
  );
}
