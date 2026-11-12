/** Detail views for planning items: a task and an event. */
import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { ResourceHeader } from "../resources/views/ResourceHeader";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { EmptyState } from "../ui/misc";
import { moveItem, newStepId, toggleTask, trashItem, updateData } from "./actions";
import { dataOf, describeRepeat, goalFraction, stepProgress, type Priority, type Repeat, type Step } from "./model";
import { BlurInput, ContainerPicker, Field, PRIORITY_LABEL } from "./ui";

export function TaskView({ id }: { id: string }) {
  const p = useStore((s) => s.pages[id]);
  if (!p || p.deletedAt) return <EmptyState icon="warning" title="This task is not here any more" text="It may have been deleted." />;
  const d = dataOf(p, "task");
  const set = (patch: Parameters<typeof updateData<"task">>[2]) => updateData(p, "task", patch);
  const sp = stepProgress(d.steps);

  return (
    <div className="res-view pl-detail">
      <ResourceHeader
        meta={p}
        subtitle={d.done ? <span className="pl-done-badge">Done</span> : d.someday ? <span>Someday</span> : undefined}
        actions={
          <Button variant={d.done ? "plain" : "tinted"} icon="check" onClick={() => toggleTask(p)}>
            {d.done ? "Mark not done" : d.repeat && d.due ? "Done, next one" : "Mark done"}
          </Button>
        }
      />

      <section className="res-card pl-fields">
        <Field label="Due">
          <input className="field" type="date" value={d.due ?? ""} onChange={(e) => set({ due: e.target.value || null, someday: e.target.value ? false : d.someday })} />
        </Field>
        <Field label="Time">
          <input className="field" type="time" value={d.time ?? ""} disabled={!d.due} onChange={(e) => set({ time: e.target.value || null })} />
        </Field>
        <Field label="Priority">
          <Segmented
            value={String(d.priority ?? 0)}
            onChange={(v) => set({ priority: Number(v) as Priority })}
            label="Priority"
            options={([0, 1, 2, 3] as Priority[]).map((n) => ({ value: String(n), label: PRIORITY_LABEL[n] }))}
          />
        </Field>
        <Field label="Repeat">
          <RepeatPicker value={d.repeat ?? null} onChange={(repeat) => set({ repeat })} />
        </Field>
        <Field label="Project">
          <ContainerPicker value={p.parentId} onChange={(pid) => moveItem(p, pid)} />
        </Field>
        <Field label="Someday">
          <Segmented
            value={d.someday ? "yes" : "no"}
            onChange={(v) => set({ someday: v === "yes", due: v === "yes" ? null : d.due })}
            label="Someday"
            options={[{ value: "no", label: "Active" }, { value: "yes", label: "Someday" }]}
          />
        </Field>
      </section>

      <section className="pl-section">
        <h2 className="pl-section-title">
          Steps {sp.total > 0 && <span className="pl-count">{sp.done}/{sp.total}</span>}
        </h2>
        <Steps steps={d.steps ?? []} onChange={(steps) => set({ steps })} />
      </section>

      <section className="pl-section">
        <h2 className="pl-section-title">Notes</h2>
        <BlurInput multiline value={d.notes ?? ""} placeholder="Anything worth remembering about this task" onCommit={(notes) => set({ notes })} className="pl-notes" />
      </section>

      <div className="pl-detail-foot">
        <Button variant="danger" icon="delete" onClick={() => trashItem(p)}>Delete task</Button>
      </div>
    </div>
  );
}

export function RepeatPicker({ value, onChange }: { value: Repeat | null; onChange: (r: Repeat | null) => void }) {
  const options = [
    { value: "none", label: "Never" },
    { value: "1:day", label: "Every day" },
    { value: "1:week", label: "Every week" },
    { value: "2:week", label: "Every 2 weeks" },
    { value: "1:month", label: "Every month" },
  ];
  const key = value ? `${value.every}:${value.unit}` : "none";
  if (value && !options.some((o) => o.value === key)) options.push({ value: key, label: describeRepeat(value) });
  return (
    <Select
      value={key}
      options={options}
      onChange={(v) => {
        if (v === "none") return onChange(null);
        const [n, unit] = v.split(":");
        onChange({ every: Number(n), unit: unit as Repeat["unit"] });
      }}
    />
  );
}

/** A checklist of steps: tick, rename inline, add with Enter, remove. */
export function Steps({ steps, onChange }: { steps: Step[]; onChange: (s: Step[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...steps, { id: newStepId(), text: t, done: false }]);
    setDraft("");
  };
  return (
    <div className="pl-steps">
      {steps.map((s) => (
        <div key={s.id} className={`pl-step ${s.done ? "is-done" : ""}`}>
          <button type="button" role="checkbox" aria-checked={s.done} aria-label={s.text} className={`pl-check pl-check-sm ${s.done ? "is-done" : ""}`} onClick={() => onChange(steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))}>
            {s.done && <Icon name="check" size={10} />}
          </button>
          <input
            className="pl-step-text bidi"
            dir="auto"
            defaultValue={s.text}
            onBlur={(e) => e.target.value !== s.text && onChange(steps.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)).filter((x) => x.text.trim()))}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <IconButton icon="close" label="Remove step" className="pl-step-remove" onClick={() => onChange(steps.filter((x) => x.id !== s.id))} />
        </div>
      ))}
      <div className="pl-step pl-step-new">
        <Icon name="add" size={14} />
        <input className="pl-step-text bidi" dir="auto" placeholder="Add a step" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} onBlur={add} />
      </div>
    </div>
  );
}

// Read when shown, not when the module loads: the Arabic date locale is set up after start, and a
// list made at load time kept English names ("Thu, Sat") in an Arabic timetable.
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
  i,
  get short() {
    return new Date(2026, 10, 8 + i).toLocaleDateString(undefined, { weekday: "short" });
  },
}));

export function EventView({ id }: { id: string }) {
  const p = useStore((s) => s.pages[id]);
  if (!p || p.deletedAt) return <EmptyState icon="warning" title="This event is not here any more" text="It may have been deleted." />;
  const d = dataOf(p, "event");
  const set = (patch: Parameters<typeof updateData<"event">>[2]) => updateData(p, "event", patch);
  const repeating = !!d.weekly?.length;

  return (
    <div className="res-view pl-detail">
      <ResourceHeader meta={p} subtitle={repeating ? <span>Repeats weekly</span> : undefined} />
      <section className="res-card pl-fields">
        <Field label={repeating ? "Starts on" : "Date"}>
          <input className="field" type="date" value={d.date ?? ""} onChange={(e) => set({ date: e.target.value || null })} />
        </Field>
        <Field label="All day">
          <Segmented value={d.allDay ? "yes" : "no"} onChange={(v) => set({ allDay: v === "yes" })} label="All day" options={[{ value: "no", label: "At a time" }, { value: "yes", label: "All day" }]} />
        </Field>
        {!d.allDay && (
          <>
            <Field label="From">
              <input className="field" type="time" value={d.start ?? ""} onChange={(e) => set({ start: e.target.value || null })} />
            </Field>
            <Field label="To">
              <input className="field" type="time" value={d.end ?? ""} onChange={(e) => set({ end: e.target.value || null })} />
            </Field>
          </>
        )}
        <Field label="Location">
          <BlurInput value={d.location ?? ""} placeholder="Room, address or link" onCommit={(location) => set({ location })} />
        </Field>
        <Field label="Project">
          <ContainerPicker value={p.parentId} onChange={(pid) => moveItem(p, pid)} />
        </Field>
        <Field label="Repeats on" wide>
          <div className="pl-days">
            {WEEKDAYS.map(({ i, short }) => {
              const on = d.weekly?.includes(i) ?? false;
              return (
                <button key={i} type="button" className={`pl-day ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => set({ weekly: on ? (d.weekly ?? []).filter((x) => x !== i) : [...(d.weekly ?? []), i].sort() })}>
                  {short}
                </button>
              );
            })}
          </div>
        </Field>
        {repeating && (
          <Field label="Until">
            <input className="field" type="date" value={d.until ?? ""} onChange={(e) => set({ until: e.target.value || null })} />
          </Field>
        )}
      </section>
      <section className="pl-section">
        <h2 className="pl-section-title">Notes</h2>
        <BlurInput multiline value={d.notes ?? ""} placeholder="Agenda, people, anything to remember" onCommit={(notes) => set({ notes })} className="pl-notes" />
      </section>
      <div className="pl-detail-foot">
        <Button variant="danger" icon="delete" onClick={() => trashItem(p)}>Delete event</Button>
      </div>
    </div>
  );
}

export function GoalView({ id }: { id: string }) {
  const p = useStore((s) => s.pages[id]);
  if (!p || p.deletedAt) return <EmptyState icon="warning" title="This goal is not here any more" text="It may have been deleted." />;
  const d = dataOf(p, "goal");
  const set = (patch: Parameters<typeof updateData<"goal">>[2]) => updateData(p, "goal", patch);
  const sp = stepProgress(d.steps);
  const pct = Math.round(goalFraction(d) * 100);

  return (
    <div className="res-view pl-detail">
      <ResourceHeader meta={p} subtitle={<span>{pct}% complete</span>} />

      <section className="res-card pl-fields">
        <Field label="Target date">
          <input className="field" type="date" value={d.target ?? ""} onChange={(e) => set({ target: e.target.value || null })} />
        </Field>
        <Field label="Project">
          <ContainerPicker value={p.parentId} onChange={(pid) => moveItem(p, pid)} />
        </Field>
        {sp.total === 0 && (
          <Field label={`Progress (${pct}%)`} wide>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => set({ progress: Number(e.target.value) / 100 })}
              style={{ width: "100%" }}
            />
          </Field>
        )}
      </section>

      <section className="pl-section">
        <h2 className="pl-section-title">
          Milestones & Steps {sp.total > 0 && <span className="pl-count">{sp.done}/{sp.total}</span>}
        </h2>
        <Steps steps={d.steps ?? []} onChange={(steps) => set({ steps })} />
      </section>

      <section className="pl-section">
        <h2 className="pl-section-title">Why & Details</h2>
        <BlurInput multiline value={d.detail ?? ""} placeholder="What success looks like and why this goal matters" onCommit={(detail) => set({ detail })} className="pl-notes" />
      </section>

      <div className="pl-detail-foot">
        <Button variant="danger" icon="delete" onClick={() => trashItem(p)}>Delete goal</Button>
      </div>
    </div>
  );
}

/** Focus / Pomodoro timer bar + optional Reading Ruler overlay. */
export function FocusTimerBar() {
  const [secondsLeft, setSecondsLeft] = useState<number>(25 * 60);
  const [running, setRunning] = useState<boolean>(false);
  const [mode, setMode] = useState<"25" | "50" | "5">("25");
  const [rulerY, setRulerY] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setRunning(false);
          useStore.getState().toast({ message: "Focus session complete. Time for a short break.", tone: "success" });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (rulerY === null) return;
    const onMove = (e: MouseEvent) => setRulerY(e.clientY);
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [rulerY]);

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");

  const selectPreset = (m: "25" | "50" | "5") => {
    setRunning(false);
    setMode(m);
    setSecondsLeft(Number(m) * 60);
  };

  return (
    <>
      <div className="res-card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="clock" size={15} />
          <span>Focus Timer</span>
        </span>
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 16, fontWeight: 700, minWidth: 58 }}>
          {mins}:{secs}
        </span>
        <button className={`chip-btn ${running ? "is-accent" : ""}`} onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Start"}
        </button>
        <button className="chip-btn" onClick={() => selectPreset(mode)}>Reset</button>
        <span style={{ flex: 1 }} />
        <button className={`chip-btn ${mode === "25" ? "is-accent" : ""}`} onClick={() => selectPreset("25")}>25m Focus</button>
        <button className={`chip-btn ${mode === "50" ? "is-accent" : ""}`} onClick={() => selectPreset("50")}>50m Deep</button>
        <button className={`chip-btn ${mode === "5" ? "is-accent" : ""}`} onClick={() => selectPreset("5")}>5m Break</button>
        <button
          className={`chip-btn ${rulerY !== null ? "is-accent" : ""}`}
          onClick={() => setRulerY((y) => (y === null ? 260 : null))}
          title="Reading Ruler Line Overlay"
        >
          <Icon name="text" size={14} /> Reading Ruler
        </button>
      </div>
      {rulerY !== null && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: Math.max(40, rulerY - 18),
            height: 36,
            background: "rgba(250, 204, 21, 0.14)",
            borderTop: "1px solid rgba(250, 204, 21, 0.45)",
            borderBottom: "2px solid rgba(250, 204, 21, 0.75)",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        />
      )}
    </>
  );
}
