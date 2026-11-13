/**
 * The Teacher pack's daily attendance: pick a class and a day, then one tap
 * per student. Each mark is an attendance item, made the first time and
 * changed after, so the gradebook, Home and Claude all see the same record.
 */
import { useMemo, useState } from "react";
import { pageTitle, useStore } from "../../state/store";
import { Segmented } from "../../ui/Segmented";
import { Select } from "../../ui/Select";
import { EmptyState } from "../../ui/misc";
import { createPackItem, itemData, updatePackItem } from "../items";
import { packDef } from "../registry";
import { packItems, todayIso } from "../rules";
import { formatField } from "../fields";

type Status = "present" | "absent" | "late" | "excused";
const STATUSES: { value: Status; label: string }[] = [
  { value: "present", label: "In class" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "excused", label: "Excused" },
];

export function TeacherAttendance() {
  const pack = packDef("teacher")!;
  const pages = useStore((s) => s.pages);
  const classes = useMemo(() => packItems(pages, pack, "class").sort((a, b) => pageTitle(a).localeCompare(pageTitle(b))), [pages, pack]);
  const [classId, setClassId] = useState<string>("");
  const [day, setDay] = useState(todayIso());
  const current = classId || classes[0]?.id || "";
  const students = useMemo(
    () =>
      packItems(pages, pack, "student")
        .filter((s) => itemData(s).class === current)
        .sort((a, b) => Number(itemData(a).number ?? 999) - Number(itemData(b).number ?? 999) || pageTitle(a).localeCompare(pageTitle(b))),
    [pages, pack, current],
  );
  const marks = useMemo(() => {
    const out = new Map<string, (typeof students)[number]>();
    for (const a of packItems(pages, pack, "attendance")) {
      const d = itemData(a);
      if (d.date === day && typeof d.student === "string") out.set(d.student, a);
    }
    return out;
  }, [pages, pack, day]);
  const kind = pack.kinds.find((k) => k.id === "attendance")!;
  const dateField = kind.fields.find((f) => f.id === "date")!;

  const mark = (studentId: string, name: string, status: Status) => {
    const existing = marks.get(studentId);
    if (existing) void updatePackItem(existing, { status });
    else void createPackItem(pack, kind, { title: `${name}, ${formatField(dateField, day)}`, data: { student: studentId, date: day, status, parentTold: false }, open: false });
  };
  const counts = STATUSES.map((s) => ({ ...s, n: students.filter((st) => (itemData(marks.get(st.id)).status ?? "") === s.value).length }));

  return (
    <div className="pl-view pk-view">
      <header className="pl-head">
        <div>
          <h1 className="pl-title">Attendance</h1>
          <p className="pl-sub">One tap per student. Absences show on Home until the parent is told.</p>
        </div>
        <div className="pl-head-controls">
          {classes.length > 0 && <Select value={current} label="Class" options={classes.map((c) => ({ value: c.id, label: pageTitle(c) }))} onChange={setClassId} />}
          <input className="field" type="date" value={day} aria-label="Day" onChange={(e) => e.target.value && setDay(e.target.value)} />
        </div>
      </header>
      {classes.length === 0 ? (
        <EmptyState icon="users" title="No classes yet" text="Add a class and its students first; attendance lists them here." />
      ) : students.length === 0 ? (
        <EmptyState icon="user" title="No students in this class" text="Add students and choose this class for them." />
      ) : (
        <>
          <div className="pk-alerts">
            {counts
              .filter((c) => c.n)
              .map((c) => (
                <span key={c.value} className="pk-alert-chip pk-att-count">
                  {c.label} <span className="pl-count">{c.n}</span>
                </span>
              ))}
          </div>
          <ul className="pk-att">
            {students.map((s) => {
              const status = (itemData(marks.get(s.id)).status as Status | undefined) ?? ("" as Status);
              const name = pageTitle(s);
              return (
                <li key={s.id} className={`pk-att-row is-${status || "none"}`}>
                  <span className="pk-att-number">{String(itemData(s).number ?? "")}</span>
                  <span className="pk-att-name bidi">{name}</span>
                  <Segmented value={status} options={STATUSES} onChange={(v) => mark(s.id, name, v)} label={name} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
