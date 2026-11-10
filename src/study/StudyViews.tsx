/** The Study pack: subjects, their timetable, and the work that belongs to them. */
import { useMemo } from "react";
import type { PageMeta } from "../lib/types";
import { pageTitle, useStore } from "../state/store";
import { ResourceHeader } from "../resources/views/ResourceHeader";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { menuAt } from "../ui/Menu";
import { EmptyState, PageIcon, relTime } from "../ui/misc";
import { PROP_COLORS, type PropColor } from "../pages/properties";
import { createItem, trashItem, updateData } from "../planning/actions";
import { addDays, dataOf, detectLinkProvider, formatTime, inSubject, occurrences, openStudyWork, relDay, subjectOf, subjects, today, weekday, type DataKind, type SubjectBook, type SubjectLink } from "../planning/model";
import { BlurInput, colorVar, DueLabel, Field, GroupHead, ItemRow, NumberInput, QuickAdd } from "../planning/ui";
import { FocusTimerBar, WEEKDAYS } from "../planning/ItemViews";
import { promptText } from "../editor/prompt";

export const SUBJECT_COLORS = Object.keys(PROP_COLORS) as PropColor[];

export async function createSubject(open = true) {
  const used = subjects(useStore.getState().pages).length;
  return createItem("subject", { title: "", data: { color: SUBJECT_COLORS[used % SUBJECT_COLORS.length] }, open: open ? "current" : false });
}

/** Study home: today's classes, what is due, and every subject. */
export function StudyView() {
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  const now = today();
  const subs = useMemo(() => subjects(pages), [pages]);
  const classes = useMemo(() => occurrences(pages, now, now).filter((o) => o.kind === "event" && !!subjectOf(pages, o.page)), [pages, now]);
  const work = useMemo(() => openStudyWork(pages, now, 14).filter((o) => !o.done), [pages, now]);

  if (subs.length === 0) {
    return (
      <div className="pl-view">
        <EmptyState
          icon="calendar"
          title="Set up your subjects"
          text="Add each subject you take. Then give it class times, and file assignments, exams and lesson notes under it."
          action={<Button variant="tinted" icon="add" onClick={() => createSubject()}>Add a subject</Button>}
        />
      </div>
    );
  }

  return (
    <div className="pl-view">
      <header className="pl-head">
        <div>
          <h1 className="pl-title">Study</h1>
          <p className="pl-sub">
            {classes.length ? `${classes.length} class${classes.length === 1 ? "" : "es"} today` : "No classes today"} · {work.length ? `${work.length} open` : "Nothing due soon"}
          </p>
        </div>
        <Button variant="tinted" icon="add" onClick={() => createSubject()}>Subject</Button>
      </header>

      <FocusTimerBar />

      {classes.length > 0 && (
        <section className="pl-group">
          <GroupHead title="Today's classes" count={classes.length} />
          <div className="study-classes">
            {classes.map((o) => {
              const subject = o.page.parentId ? pages[o.page.parentId] : undefined;
              const d = dataOf(o.page, "event");
              return (
                <button key={o.key} className="study-class" style={{ "--chip": colorVar(o.color) } as React.CSSProperties} onClick={() => subject && openPage(subject.id)}>
                  <span className="study-class-time">{formatTime(o.start)}{o.end ? ` – ${formatTime(o.end)}` : ""}</span>
                  <span className="study-class-title bidi">{pageTitle(subject ?? o.page)}</span>
                  {(d.location || (subject && dataOf(subject, "subject").room)) && <span className="study-class-room bidi">{d.location || dataOf(subject!, "subject").room}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="pl-group">
        <GroupHead title="Due in the next two weeks" count={work.length} />
        {work.length ? (
          <div className="pl-list">
            {work.map((o) => (
              <ItemRow key={o.key} p={o.page} />
            ))}
          </div>
        ) : (
          <p className="pl-hint">Nothing due. Add assignments and exams from a subject's page.</p>
        )}
      </section>

      <section className="pl-group">
        <GroupHead title="Subjects" count={subs.length} />
        <div className="study-grid">
          {subs.map((s) => (
            <SubjectCard key={s.id} s={s} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SubjectCard({ s }: { s: PageMeta }) {
  const pages = useStore((st) => st.pages);
  const openPage = useStore((st) => st.openPage);
  const d = dataOf(s, "subject");
  const open = [...inSubject(pages, s.id, "assignment").filter((p) => !dataOf(p, "assignment").submitted), ...inSubject(pages, s.id, "requirement").filter((p) => !dataOf(p, "requirement").ready)];
  const nextExam = inSubject(pages, s.id, "exam")
    .map((p) => dataOf(p, "exam").date)
    .filter((x): x is string => !!x && x >= today())
    .sort()[0];
  return (
    <button className="study-card" style={{ "--chip": colorVar(d.color) } as React.CSSProperties} onClick={(e) => openPage(s.id, e.ctrlKey ? "tab" : "current")}>
      <span className="study-card-top">
        <span className="study-swatch" />
        <span className="study-card-title bidi">{pageTitle(s)}</span>
      </span>
      <span className="study-card-sub bidi">{[d.teacher, d.room].filter(Boolean).join(" · ") || "No teacher or room yet"}</span>
      <span className="study-card-foot">
        <span>{open.length ? `${open.length} open` : "All done"}</span>
        {nextExam && <span>Exam {relDay(nextExam)}</span>}
      </span>
    </button>
  );
}

/** A subject: details, its weekly classes, and everything filed under it. */
export function SubjectView({ id }: { id: string }) {
  const p = useStore((s) => s.pages[id]);
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  if (!p || p.deletedAt) return <EmptyState icon="warning" title="This subject is not here any more" text="It may have been deleted." />;
  const d = dataOf(p, "subject");
  const set = (patch: Partial<typeof d>) => updateData(p, "subject", patch);

  const classes = inSubject(pages, id, "event").sort((a, b) => (dataOf(a, "event").start ?? "").localeCompare(dataOf(b, "event").start ?? ""));
  const assignments = inSubject(pages, id, "assignment").sort((a, b) => (dataOf(a, "assignment").due ?? "9").localeCompare(dataOf(b, "assignment").due ?? "9"));
  const exams = inSubject(pages, id, "exam").sort((a, b) => (dataOf(a, "exam").date ?? "9").localeCompare(dataOf(b, "exam").date ?? "9"));
  const bring = inSubject(pages, id, "requirement");
  const tasks = inSubject(pages, id, "task").filter((t) => !dataOf(t, "task").done);
  const lessons = Object.values(pages)
    .filter((x) => x.parentId === id && x.kind === "lesson" && !x.deletedAt)
    .sort((a, b) => (dataOf(b, "lesson").taughtOn ?? "").localeCompare(dataOf(a, "lesson").taughtOn ?? "") || b.createdAt - a.createdAt);
  const openWork = assignments.filter((a) => !dataOf(a, "assignment").submitted);
  const doneWork = assignments.filter((a) => dataOf(a, "assignment").submitted);

  const graded = [...assignments.map((a) => dataOf(a, "assignment")).filter((a) => a.points && a.earned != null).map((a) => [a.earned!, a.points!]), ...exams.map((e) => dataOf(e, "exam")).filter((e) => e.maxScore && e.score != null).map((e) => [e.score!, e.maxScore!])];
  const average = graded.length ? Math.round((graded.reduce((s, [e]) => s + e, 0) / graded.reduce((s, [, m]) => s + m, 0)) * 100) : null;

  const addClass = async () => {
    const t = today();
    await createItem("event", { title: p.title, parentId: id, data: { date: t, weekly: [weekday(t)], start: "08:00", end: "08:45", location: d.room ?? "" }, open: "current" });
  };
  const addLesson = async () => {
    const s = useStore.getState();
    await s.createPage({ kind: "lesson", title: "", parentId: id, icon: "pi:notebook", metadata: { lesson: { taughtOn: today(), number: lessons.length + 1 } } }, "current");
  };

  return (
    <div className="res-view pl-detail study-subject" style={{ "--chip": colorVar(d.color) } as React.CSSProperties}>
      <ResourceHeader meta={p} subtitle={average != null ? <span>Average {average}%</span> : undefined} actions={<Button variant="tinted" icon="add" onClick={(e) => menuAt(e.currentTarget, newInSubjectMenu(id), "end")}>New</Button>} />

      <section className="res-card pl-fields">
        <Field label="Teacher"><BlurInput value={d.teacher ?? ""} placeholder="Who teaches it" onCommit={(teacher) => set({ teacher })} /></Field>
        <Field label="Room"><BlurInput value={d.room ?? ""} placeholder="Where" onCommit={(room) => set({ room })} /></Field>
        <Field label="Code"><BlurInput value={d.code ?? ""} placeholder="e.g. CHEM 101" onCommit={(code) => set({ code })} /></Field>
        <Field label="Colour" wide>
          <div className="study-colors">
            {SUBJECT_COLORS.map((c) => (
              <button key={c} type="button" className={`study-color ${d.color === c ? "is-on" : ""}`} style={{ background: colorVar(c) }} aria-label={c} aria-pressed={d.color === c} onClick={() => set({ color: c })} />
            ))}
          </div>
        </Field>
      </section>

      <section className="pl-section">
        <div className="pl-section-head">
          <h2 className="pl-section-title">Timetable</h2>
          <Button variant="quiet" size="compact" icon="add" onClick={addClass}>Class time</Button>
        </div>
        {classes.length ? (
          <div className="study-slots">
            {classes.map((c) => {
              const e = dataOf(c, "event");
              return (
                <button key={c.id} className="study-slot" onClick={() => openPage(c.id)}>
                  <span className="study-slot-days">{(e.weekly ?? []).map((i) => WEEKDAYS[i].short).join(", ") || (e.date ? relDay(e.date) : "")}</span>
                  <span className="study-slot-time">{formatTime(e.start)}{e.end ? ` – ${formatTime(e.end)}` : ""}</span>
                  {e.location && <span className="study-slot-room bidi">{e.location}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="pl-hint">Add the times this subject meets each week. They appear in Calendar and on Study.</p>
        )}
      </section>

      <section className="pl-section">
        <div className="pl-section-head">
          <h2 className="pl-section-title">Assignments {openWork.length > 0 && <span className="pl-count">{openWork.length}</span>}</h2>
        </div>
        <QuickAdd placeholder="Add an assignment — “Lab report sunday”" onAdd={(q) => createItem("assignment", { title: q.title, parentId: id, data: { due: q.due, time: q.time, teacher: d.teacher } })} />
        <div className="pl-list">{openWork.map((a) => <ItemRow key={a.id} p={a} showParent={false} />)}</div>
        {doneWork.length > 0 && (
          <details className="pl-done-fold">
            <summary>{doneWork.length} handed in</summary>
            <div className="pl-list">{doneWork.map((a) => <ItemRow key={a.id} p={a} showParent={false} />)}</div>
          </details>
        )}
      </section>

      <section className="pl-section">
        <h2 className="pl-section-title">Exams</h2>
        <QuickAdd placeholder="Add an exam — “Midterm 24/11 8am”" onAdd={(q) => createItem("exam", { title: q.title, parentId: id, data: { date: q.due, time: q.time } })} />
        <div className="pl-list">{exams.map((x) => <ItemRow key={x.id} p={x} showParent={false} />)}</div>
      </section>

      <section className="pl-section">
        <h2 className="pl-section-title">To bring or print</h2>
        <QuickAdd placeholder="Something to bring — “Calculator tomorrow”" onAdd={(q) => createItem("requirement", { title: q.title, parentId: id, data: { due: q.due } })} />
        <div className="pl-list">{bring.map((x) => <ItemRow key={x.id} p={x} showParent={false} />)}</div>
      </section>

      {tasks.length > 0 && (
        <section className="pl-section">
          <h2 className="pl-section-title">Tasks</h2>
          <div className="pl-list">{tasks.map((x) => <ItemRow key={x.id} p={x} showParent={false} />)}</div>
        </section>
      )}

      <section className="pl-section">
        <div className="pl-section-head">
          <h2 className="pl-section-title">Textbooks & Solution Books</h2>
          <Button
            variant="quiet"
            size="compact"
            icon="add"
            onClick={async () => {
              const title = await promptText({ title: "Add Textbook or Solution Book", placeholder: "e.g. Calculus Textbook / كتاب الحلول" });
              if (!title?.trim()) return;
              const isSol = /حلول|solution/i.test(title);
              const nextBook: SubjectBook = {
                id: `bk_${Date.now().toString(36)}`,
                title: title.trim(),
                kind: isSol ? "solutions" : "textbook",
                totalPages: 250,
                currentPage: 1,
              };
              set({ books: [...(d.books ?? []), nextBook] });
            }}
          >
            Add Book
          </Button>
        </div>
        {(d.books ?? []).length > 0 ? (
          <div className="pl-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(d.books ?? []).map((bk) => {
              const pct = bk.totalPages > 0 ? Math.min(100, Math.round((bk.currentPage / bk.totalPages) * 100)) : 0;
              return (
                <div key={bk.id} className="res-card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
                  <span>{bk.kind === "solutions" ? "📗" : "📘"}</span>
                  <span className="bidi" style={{ fontWeight: 600, flex: 1 }}>{bk.title}</span>
                  <span className="tag">{bk.kind === "solutions" ? "Solutions" : "Textbook"}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span>Page</span>
                    <input
                      type="number"
                      className="field"
                      style={{ width: 64, height: 26, padding: "0 6px" }}
                      value={bk.currentPage}
                      min={1}
                      max={bk.totalPages}
                      onChange={(e) => {
                        const cp = Math.max(1, Number(e.target.value) || 1);
                        set({ books: (d.books ?? []).map((x) => (x.id === bk.id ? { ...x, currentPage: cp } : x)) });
                      }}
                    />
                    <span>/</span>
                    <input
                      type="number"
                      className="field"
                      style={{ width: 64, height: 26, padding: "0 6px" }}
                      value={bk.totalPages}
                      min={1}
                      onChange={(e) => {
                        const tp = Math.max(1, Number(e.target.value) || 1);
                        set({ books: (d.books ?? []).map((x) => (x.id === bk.id ? { ...x, totalPages: tp } : x)) });
                      }}
                    />
                    <span style={{ opacity: 0.75 }}>({pct}%)</span>
                    <button
                      className="chip-btn"
                      onClick={() => set({ books: (d.books ?? []).filter((x) => x.id !== bk.id) })}
                      title="Remove book"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="pl-hint">Track textbooks and solution books with your current page bookmark.</p>
        )}
      </section>

      <section className="pl-section">
        <div className="pl-section-head">
          <h2 className="pl-section-title">Resources & Links (YouTube, Telegram, Classroom, مدرستي)</h2>
          <Button
            variant="quiet"
            size="compact"
            icon="add"
            onClick={async () => {
              const url = await promptText({ title: "Add Resource Link", placeholder: "https://..." });
              if (!url?.trim()) return;
              const prov = detectLinkProvider(url.trim());
              const nextLink: SubjectLink = {
                id: `lnk_${Date.now().toString(36)}`,
                title: prov.label,
                url: url.trim(),
              };
              set({ links: [...(d.links ?? []), nextLink] });
            }}
          >
            Add Link
          </Button>
        </div>
        {(d.links ?? []).length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(d.links ?? []).map((lnk) => {
              const prov = detectLinkProvider(lnk.url);
              return (
                <div key={lnk.id} className="res-card" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px" }}>
                  <span>{prov.icon}</span>
                  <a href={lnk.url} target="_blank" rel="noreferrer" className="bidi" style={{ color: "inherit", fontWeight: 500, fontSize: 13 }}>
                    {lnk.title || prov.label}
                  </a>
                  <span className="tag">{prov.label}</span>
                  <button
                    className="chip-btn"
                    onClick={() => set({ links: (d.links ?? []).filter((x) => x.id !== lnk.id) })}
                    title="Remove link"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="pl-hint">Save channel links, playlists, Telegram groups, Google Drive folders, or Madrasati links.</p>
        )}
      </section>

      <section className="pl-section">
        <div className="pl-section-head">
          <h2 className="pl-section-title">Lessons</h2>
          <Button variant="quiet" size="compact" icon="add" onClick={addLesson}>Lesson notes</Button>
        </div>
        {lessons.length ? (
          <div className="study-lessons">
            {lessons.map((l) => {
              const ld = dataOf(l, "lesson");
              return (
                <button key={l.id} className="study-lesson" onClick={(e) => openPage(l.id, e.ctrlKey ? "tab" : "current")}>
                  <PageIcon icon={l.icon ?? "pi:notebook"} size={18} />
                  <span className="study-lesson-title bidi">{ld.number ? `${ld.number}. ` : ""}{pageTitle(l)}</span>
                  <span className="study-lesson-date">{ld.taughtOn ? relDay(ld.taughtOn) : relTime(l.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="pl-hint">Notes from each lesson, written like any page and filed under this subject.</p>
        )}
      </section>

      <div className="pl-detail-foot">
        <Button variant="danger" icon="delete" onClick={() => trashItem(p)}>Delete subject</Button>
        <span className="pl-hint">Deleting a subject moves its classes, work and lessons to Trash with it.</span>
      </div>
    </div>
  );
}

function newInSubjectMenu(subjectId: string) {
  const make = (kind: DataKind) => () => createItem(kind as "assignment", { title: "", parentId: subjectId, data: {}, open: "current" });
  return [
    { label: "Assignment", icon: "edit" as const, onSelect: make("assignment") },
    { label: "Exam", icon: "info" as const, onSelect: make("exam") },
    { label: "Something to bring", icon: "file" as const, onSelect: make("requirement") },
    { label: "Task", icon: "checklist" as const, onSelect: make("task") },
    { kind: "separator" as const },
    { label: "Lesson notes", icon: "page" as const, onSelect: () => useStore.getState().createPage({ kind: "lesson", title: "", parentId: subjectId, icon: "pi:notebook", metadata: { lesson: { taughtOn: today() } } }, "current") },
  ];
}

/** An assignment, an exam or something to bring. */
export function StudyItemView({ id }: { id: string }) {
  const p = useStore((s) => s.pages[id]);
  const pages = useStore((s) => s.pages);
  const openPage = useStore((s) => s.openPage);
  if (!p || p.deletedAt) return <EmptyState icon="warning" title="This is not here any more" text="It may have been deleted." />;
  const subject = p.parentId ? pages[p.parentId] : undefined;
  const back = subject && subject.kind === "subject" ? (
    <button className="link-btn" onClick={() => openPage(subject.id)}>
      <Icon name="back" size={12} /> {pageTitle(subject)}
    </button>
  ) : undefined;

  if (p.kind === "assignment") {
    const d = dataOf(p, "assignment");
    const set = (patch: Partial<typeof d>) => updateData(p, "assignment", patch);
    return (
      <div className="res-view pl-detail">
        <ResourceHeader
          meta={p}
          subtitle={back}
          actions={
            <Button variant={d.submitted ? "plain" : "tinted"} icon="check" onClick={() => set({ submitted: !d.submitted, submittedAt: d.submitted ? null : Date.now() })}>
              {d.submitted ? "Not handed in" : "Hand in"}
            </Button>
          }
        />
        <section className="res-card pl-fields">
          <Field label="Due"><input className="field" type="date" value={d.due ?? ""} onChange={(e) => set({ due: e.target.value || null })} /></Field>
          <Field label="Time"><input className="field" type="time" value={d.time ?? ""} onChange={(e) => set({ time: e.target.value || null })} /></Field>
          <Field label="Given on"><input className="field" type="date" value={d.assigned ?? ""} onChange={(e) => set({ assigned: e.target.value || null })} /></Field>
          <Field label="Teacher"><BlurInput value={d.teacher ?? ""} onCommit={(teacher) => set({ teacher })} /></Field>
          <Field label="Out of"><NumberInput value={d.points} placeholder="Points" onCommit={(points) => set({ points })} /></Field>
          <Field label="Grade"><NumberInput value={d.earned} placeholder="Earned" onCommit={(earned) => set({ earned })} /></Field>
        </section>
        <section className="pl-section">
          <h2 className="pl-section-title">Instructions</h2>
          <BlurInput multiline value={d.instructions ?? ""} placeholder="What the teacher asked for" onCommit={(instructions) => set({ instructions })} className="pl-notes" />
        </section>
        {d.due && <p className="pl-hint">Due <DueLabel due={d.due} time={d.time} done={d.submitted} /></p>}
        <div className="pl-detail-foot"><Button variant="danger" icon="delete" onClick={() => trashItem(p)}>Delete</Button></div>
      </div>
    );
  }

  if (p.kind === "exam") {
    const d = dataOf(p, "exam");
    const set = (patch: Partial<typeof d>) => updateData(p, "exam", patch);
    const daysLeft = d.date ? Math.round((new Date(d.date + "T00:00").getTime() - new Date(today() + "T00:00").getTime()) / 86_400_000) : null;
    return (
      <div className="res-view pl-detail">
        <ResourceHeader meta={p} subtitle={back} />
        {daysLeft != null && daysLeft >= 0 && (
          <div className="res-card study-countdown">
            <span className="study-countdown-n">{daysLeft === 0 ? "Today" : daysLeft}</span>
            {daysLeft > 0 && <span>day{daysLeft === 1 ? "" : "s"} to go</span>}
          </div>
        )}
        <section className="res-card pl-fields">
          <Field label="Date"><input className="field" type="date" value={d.date ?? ""} onChange={(e) => set({ date: e.target.value || null })} /></Field>
          <Field label="Time"><input className="field" type="time" value={d.time ?? ""} onChange={(e) => set({ time: e.target.value || null })} /></Field>
          <Field label="Location"><BlurInput value={d.location ?? ""} onCommit={(location) => set({ location })} /></Field>
          <Field label="Out of"><NumberInput value={d.maxScore} onCommit={(maxScore) => set({ maxScore })} /></Field>
          <Field label="Score"><NumberInput value={d.score} onCommit={(score) => set({ score })} /></Field>
        </section>
        <section className="pl-section">
          <h2 className="pl-section-title">What it covers</h2>
          <BlurInput multiline value={d.scope ?? ""} placeholder="Chapters, topics, pages" onCommit={(scope) => set({ scope })} className="pl-notes" />
        </section>
        <div className="pl-detail-foot"><Button variant="danger" icon="delete" onClick={() => trashItem(p)}>Delete</Button></div>
      </div>
    );
  }

  const d = dataOf(p, "requirement");
  const set = (patch: Partial<typeof d>) => updateData(p, "requirement", patch);
  return (
    <div className="res-view pl-detail">
      <ResourceHeader meta={p} subtitle={back} actions={<Button variant={d.ready ? "plain" : "tinted"} icon="check" onClick={() => set({ ready: !d.ready })}>{d.ready ? "Not ready" : "Ready"}</Button>} />
      <section className="res-card pl-fields">
        <Field label="Needed on"><input className="field" type="date" value={d.due ?? ""} onChange={(e) => set({ due: e.target.value || null })} /></Field>
        <Field label="Needs printing">
          <button type="button" role="switch" aria-checked={!!d.print} className={`switch ${d.print ? "is-on" : ""}`} onClick={() => set({ print: !d.print })}><span className="switch-knob" /></button>
        </Field>
        {d.print && (
          <>
            <Field label="Copies">
              <NumberInput value={d.copies ?? 1} placeholder="1" onCommit={(copies) => set({ copies: copies ?? 1 })} />
            </Field>
            <Field label="Colour mode">
              <select className="field" value={d.colorMode ?? "bw"} onChange={(e) => set({ colorMode: e.target.value as "bw" | "color" })}>
                <option value="bw">Black & White (أبيض وأسود)</option>
                <option value="color">Colour (ملون)</option>
              </select>
            </Field>
            <Field label="Double-sided">
              <button type="button" role="switch" aria-checked={!!d.doubleSided} className={`switch ${d.doubleSided ? "is-on" : ""}`} onClick={() => set({ doubleSided: !d.doubleSided })}><span className="switch-knob" /></button>
            </Field>
            <Field label="Pages range">
              <BlurInput value={d.pagesRange ?? ""} placeholder="e.g. 1-15" onCommit={(pagesRange) => set({ pagesRange })} />
            </Field>
          </>
        )}
        <Field label="What exactly" wide><BlurInput value={d.action ?? ""} placeholder="e.g. Print pages 12–15, double-sided" onCommit={(action) => set({ action })} /></Field>
      </section>
      <div className="pl-detail-foot"><Button variant="danger" icon="delete" onClick={() => trashItem(p)}>Delete</Button></div>
    </div>
  );
}

/** Home's study card: next classes and what is due soon. Only rendered while Study is on. */
export function StudyHomeSection() {
  const pages = useStore((s) => s.pages);
  const open = useStore((s) => s.open);
  const now = today();
  const work = useMemo(() => openStudyWork(pages, now, 7).filter((o) => !o.done).slice(0, 6), [pages, now]);
  const classes = useMemo(() => occurrences(pages, now, addDays(now, 1)).filter((o) => o.kind === "event" && !!subjectOf(pages, o.page)).slice(0, 4), [pages, now]);
  if (!subjects(pages).length) {
    return (
      <EmptyState compact icon="calendar" title="Study is on" text="Add your subjects to see classes and homework here." action={<button className="chip-btn" onClick={() => createSubject()}>Add a subject</button>} />
    );
  }
  return (
    <div className="home-study">
      {classes.length > 0 && (
        <div className="study-classes is-compact">
          {classes.map((o) => (
            <button key={o.key} className="study-class" style={{ "--chip": colorVar(o.color) } as React.CSSProperties} onClick={() => open({ kind: "study" })}>
              <span className="study-class-time">{o.date === now ? "" : "Tomorrow · "}{formatTime(o.start)}</span>
              <span className="study-class-title bidi">{pageTitle(o.page.parentId ? pages[o.page.parentId] : o.page)}</span>
            </button>
          ))}
        </div>
      )}
      {work.length ? <div className="pl-list">{work.map((o) => <ItemRow key={o.key} p={o.page} />)}</div> : <p className="pl-hint">Nothing due this week.</p>}
    </div>
  );
}

