/** Pieces shared by Tasks, Calendar, Inbox and the Study pack. */
import { useState, type ReactNode } from "react";
import type { PageMeta } from "../lib/types";
import { kindInfo } from "../resources/kinds";
import { isKindHidden } from "../packs/registry";
import { pageTitle, useStore } from "../state/store";
import { Icon } from "../ui/Icon";
import { menuAt, useMenu, type MenuItem } from "../ui/Menu";
import { PageIcon } from "../ui/misc";
import { pageMenu } from "../shell/pageActions";
import { PROP_COLORS, type PropColor } from "../pages/properties";
import { moveItem, toggleTask, updateData, trashItem } from "./actions";
import { addDays, dataOf, daysBetween, describeRepeat, formatTime, relDay, stepProgress, subjectOf, today, type Priority } from "./model";
import { parseQuickAdd, type Parsed } from "./quickAdd";

export const PRIORITY_LABEL: Record<Priority, string> = { 0: "None", 1: "Low", 2: "Medium", 3: "High" };

export function colorVar(c: PropColor | null | undefined): string | undefined {
  return c ? `rgb(${PROP_COLORS[c]})` : undefined;
}

/** A round check, coloured by priority or subject. */
export function Check({ done, onToggle, priority = 0, color, label }: { done: boolean; onToggle: () => void; priority?: Priority; color?: string; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      className={`pl-check prio-${priority} ${done ? "is-done" : ""}`}
      style={color ? ({ "--pl-check": color } as React.CSSProperties) : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {done && <Icon name="check" size={12} />}
    </button>
  );
}

export function DueLabel({ due, time, done }: { due: string | null | undefined; time?: string | null; done?: boolean }) {
  if (!due) return null;
  const diff = daysBetween(today(), due);
  const tone = done ? "" : diff < 0 ? "is-overdue" : diff === 0 ? "is-today" : diff <= 2 ? "is-soon" : "";
  return (
    <span className={`pl-due ${tone}`}>
      <Icon name="calendar" size={12} />
      {/* Its own element, so "Today" is a whole label for the Arabic interface rather than part of "Today · 7:00 PM". */}
      <span>{relDay(due)}</span>
      {time ? ` · ${formatTime(time)}` : ""}
    </span>
  );
}

/** Where an item lives: its project or subject, shown when it has one. */
export function ParentLabel({ p }: { p: PageMeta }) {
  const pages = useStore((s) => s.pages);
  const parent = p.parentId ? pages[p.parentId] : undefined;
  if (!parent || parent.deletedAt || isKindHidden(parent.kind)) return null;
  const subject = parent.kind === "subject" ? parent : subjectOf(pages, p);
  const color = subject ? colorVar(dataOf(subject, "subject").color) : undefined;
  return (
    <span className="pl-parent bidi" style={color ? { color } : undefined}>
      {color ? <span className="pl-dot" style={{ background: color }} /> : <PageIcon icon={parent.icon} size={12} />}
      {pageTitle(parent)}
    </span>
  );
}

/** One row for anything you tick off: tasks, assignments, things to bring. */
export function ItemRow({ p, showParent = true, extra }: { p: PageMeta; showParent?: boolean; extra?: ReactNode }) {
  const openPage = useStore((s) => s.openPage);
  const pages = useStore((s) => s.pages);
  const show = useMenu((s) => s.show);
  const subject = subjectOf(pages, p);
  const color = subject ? colorVar(dataOf(subject, "subject").color) : undefined;

  let done = false, due: string | null | undefined, time: string | null | undefined, priority: Priority = 0, toggle = () => {}, meta: ReactNode = null;
  if (p.kind === "task") {
    const d = dataOf(p, "task");
    done = !!d.done; due = d.due; time = d.time; priority = d.priority ?? 0;
    toggle = () => toggleTask(p);
    const sp = stepProgress(d.steps);
    meta = (
      <>
        {sp.total > 0 && <span className="pl-meta"><Icon name="checklist" size={12} />{sp.done}/{sp.total}</span>}
        {d.repeat && <span className="pl-meta"><Icon name="repeat" size={12} />{describeRepeat(d.repeat)}</span>}
        {d.notes && <span className="pl-meta"><Icon name="text" size={12} /></span>}
      </>
    );
  } else if (p.kind === "assignment") {
    const d = dataOf(p, "assignment");
    done = !!d.submitted; due = d.due; time = d.time;
    toggle = () => updateData(p, "assignment", { submitted: !d.submitted, submittedAt: d.submitted ? null : Date.now() });
    meta = d.points != null ? <span className="pl-meta">{d.earned != null ? `${d.earned}/` : ""}{d.points} pts</span> : null;
  } else if (p.kind === "requirement") {
    const d = dataOf(p, "requirement");
    done = !!d.ready; due = d.due;
    toggle = () => updateData(p, "requirement", { ready: !d.ready });
    meta = d.print ? <span className="pl-meta"><Icon name="file" size={12} />Print</span> : null;
  } else if (p.kind === "exam") {
    const d = dataOf(p, "exam");
    due = d.date; time = d.time;
    done = d.score != null;
    meta = d.score != null ? <span className="pl-meta">{d.score}{d.maxScore != null ? `/${d.maxScore}` : ""}</span> : d.scope ? <span className="pl-meta bidi">{d.scope}</span> : null;
  }

  const kindLabel = p.kind !== "task" ? <span className="pl-kind">{kindInfo(p.kind).label}</span> : null;

  return (
    <div
      className={`pl-row ${done ? "is-done" : ""}`}
      role="button"
      tabIndex={0}
      onClick={(e) => openPage(p.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
      onKeyDown={(e) => {
        if (e.key === "Enter") openPage(p.id);
        if (e.key === " " && p.kind !== "exam") {
          e.preventDefault();
          toggle();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        show(e.clientX, e.clientY, itemMenu(p));
      }}
    >
      {p.kind === "exam" ? (
        <span className="pl-check-slot"><Icon name="info" size={16} /></span>
      ) : (
        <Check done={done} onToggle={toggle} priority={priority} color={color} label={done ? "Mark not done" : "Mark done"} />
      )}
      <div className="pl-row-main">
        <span className={`pl-row-title bidi ${p.title ? "" : "is-untitled"}`}>{pageTitle(p)}</span>
        <span className="pl-row-meta">
          {kindLabel}
          <DueLabel due={due} time={time} done={done} />
          {meta}
          {showParent && <ParentLabel p={p} />}
          {extra}
        </span>
      </div>
    </div>
  );
}

/** Context menu for an item: dates, priority, move, delete, plus the usual page actions. */
export function itemMenu(p: PageMeta): MenuItem[] {
  const items: MenuItem[] = [];
  if (p.kind === "task") {
    const d = dataOf(p, "task");
    const t = today();
    items.push(
      { label: d.done ? "Mark not done" : "Mark done", icon: "check", onSelect: () => toggleTask(p) },
      { kind: "separator" },
      { label: "Today", icon: "calendar", onSelect: () => updateData(p, "task", { due: t, someday: false }) },
      { label: "Tomorrow", icon: "calendar", onSelect: () => updateData(p, "task", { due: addDays(t, 1), someday: false }) },
      { label: "Next week", icon: "calendar", onSelect: () => updateData(p, "task", { due: addDays(t, 7), someday: false }) },
      { label: "Someday", icon: "archive", onSelect: () => updateData(p, "task", { someday: true, due: null }) },
      {
        label: "Priority",
        icon: "sliders",
        submenu: ([3, 2, 1, 0] as Priority[]).map((n) => ({ label: PRIORITY_LABEL[n], checked: (d.priority ?? 0) === n, onSelect: () => updateData(p, "task", { priority: n }) })),
      },
    );
  }
  items.push(
    { label: "Move to…", icon: "move", submenu: moveTargets(p) },
    { kind: "separator" },
    { label: "Delete", icon: "delete", danger: true, onSelect: () => trashItem(p) },
  );
  const rest = pageMenu(p).filter((i) => i.kind !== "separator" && "label" in i && /open|tab|split|copy link/i.test(i.label));
  if (rest.length) items.unshift(...rest, { kind: "separator" });
  return items;
}

/** Projects (and subjects, when Study is on) an item can live in. */
export function containers(pages: Record<string, PageMeta>): PageMeta[] {
  return Object.values(pages)
    .filter((c) => (c.kind === "project" || c.kind === "subject") && !c.deletedAt && !c.archived && !isKindHidden(c.kind))
    .sort((a, b) => (a.kind === b.kind ? pageTitle(a).localeCompare(pageTitle(b)) : a.kind === "subject" ? -1 : 1));
}

function moveTargets(p: PageMeta): MenuItem[] {
  const pages = useStore.getState().pages;
  const list = containers(pages).filter((c) => c.id !== p.id);
  return [
    { label: "No project", checked: !p.parentId, onSelect: () => moveItem(p, null) },
    ...(list.length ? [{ kind: "separator" } as MenuItem] : []),
    ...list.map((c) => ({ label: pageTitle(c), checked: p.parentId === c.id, onSelect: () => moveItem(p, c.id) })),
  ];
}

/** A picker button for where an item lives. */
export function ContainerPicker({ value, onChange, allowNone = true }: { value: string | null; onChange: (id: string | null) => void; allowNone?: boolean }) {
  const pages = useStore((s) => s.pages);
  const current = value ? pages[value] : null;
  return (
    <button
      type="button"
      className="field pl-picker"
      onClick={(e) =>
        menuAt(
          e.currentTarget,
          [
            ...(allowNone ? [{ label: "No project", checked: !value, onSelect: () => onChange(null) } as MenuItem] : []),
            ...containers(pages).map((c) => ({ label: `${pageTitle(c)}${c.kind === "subject" ? " · Subject" : ""}`, checked: value === c.id, onSelect: () => onChange(c.id) })),
          ],
          "start",
          true,
        )
      }
    >
      {current ? <PageIcon icon={current.icon} size={14} /> : <Icon name="folder" size={14} />}
      <span className="bidi">{current ? pageTitle(current) : "No project"}</span>
      <Icon name="chevronDown" size={12} />
    </button>
  );
}

/** The input at the top of a list: type, press Enter, and it is added. */
export function QuickAdd({ placeholder, onAdd, autoFocus, hint = true }: { placeholder: string; onAdd: (p: Parsed, raw: string) => Promise<unknown> | void; autoFocus?: boolean; hint?: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = value.trim() ? parseQuickAdd(value) : null;
  return (
    <div className="pl-add">
      <Icon name="add" size={16} />
      <input
        className="pl-add-input bidi"
        dir="auto"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === "Enter" && parsed && (parsed.title || value.trim())) {
            setBusy(true);
            try {
              await onAdd({ ...parsed, title: parsed.title || value.trim() }, value);
              setValue("");
            } finally {
              setBusy(false);
              requestAnimationFrame(() => (e.target as HTMLInputElement).focus());
            }
          }
          if (e.key === "Escape") setValue("");
        }}
      />
      {hint && parsed && (parsed.due || parsed.priority > 0) && (
        <span className="pl-add-hint">
          {parsed.due && <DueLabel due={parsed.due} time={parsed.time} />}
          {parsed.priority > 0 && <span className={`pl-prio prio-${parsed.priority}`}>{PRIORITY_LABEL[parsed.priority]}</span>}
        </span>
      )}
    </div>
  );
}

/** A labelled field in a detail view. */
export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`pl-field ${wide ? "is-wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/** A text box that saves when it loses focus. */
export function BlurInput({ value, onCommit, placeholder, multiline, type = "text", className = "" }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean; type?: string; className?: string }) {
  const props = {
    className: `field bidi ${className}`,
    dir: "auto" as const,
    defaultValue: value,
    placeholder,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.target.value !== value && onCommit(e.target.value),
  };
  // Keyed by the value so an outside change shows; React wants the key written out, not spread.
  return multiline ? <textarea key={value} {...props} rows={4} /> : <input key={value} {...props} type={type} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

/** A number box that saves on blur; empty means none. */
export function NumberInput({ value, onCommit, placeholder }: { value: number | null | undefined; onCommit: (v: number | null) => void; placeholder?: string }) {
  return (
    <input
      className="field"
      type="number"
      key={String(value ?? "")}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value.trim() === "" ? null : Number(e.target.value);
        if (v !== (value ?? null) && (v === null || Number.isFinite(v))) onCommit(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Group header in a list. */
export function GroupHead({ title, count, tone }: { title: string; count?: number; tone?: string }) {
  return (
    <h3 className={`pl-group-head ${tone ?? ""}`}>
      <span>{title}</span>
      {count != null && <span className="pl-count">{count}</span>}
    </h3>
  );
}
