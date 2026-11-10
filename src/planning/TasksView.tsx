/** Tasks: smart lists over every task, goal, and print queue item in the workspace. */
import { useMemo } from "react";
import type { PageMeta } from "../lib/types";
import { pageTitle, useStore, type TaskListId } from "../state/store";
import { Segmented } from "../ui/Segmented";
import { EmptyState } from "../ui/misc";
import { createItem } from "./actions";
import { dataOf, goalFraction, goalsFor, printQueueFor, relDay, tasksFor, today } from "./model";
import { GroupHead, ItemRow, QuickAdd } from "./ui";
import { FocusTimerBar } from "./ItemViews";

const LISTS: { value: TaskListId; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All" },
  { value: "goals", label: "Goals" },
  { value: "print", label: "Print Queue" },
  { value: "someday", label: "Someday" },
  { value: "done", label: "Done" },
];

const EMPTY: Record<TaskListId, { title: string; text: string }> = {
  today: { title: "Nothing due today", text: "Type a task above. Words like “tomorrow 4pm” or “!!” set the date and priority." },
  upcoming: { title: "Nothing scheduled", text: "Tasks with a date after today show up here, day by day." },
  all: { title: "No open tasks", text: "Everything you still have to do, grouped by project." },
  goals: { title: "No goals yet", text: "Add a goal above to track milestones, steps, and long-term progress." },
  print: { title: "Print queue is empty", text: "Items marked for printing (copies, colour/B&W, double-sided) appear here." },
  someday: { title: "Nothing for someday", text: "Ideas and maybes, kept out of your way until you want them." },
  done: { title: "Nothing finished yet", text: "Completed tasks are kept here." },
};

export function TasksView({ list = "today" }: { list?: TaskListId }) {
  const pages = useStore((s) => s.pages);
  const open = useStore((s) => s.open);
  const openPage = useStore((s) => s.openPage);
  const now = today();
  const items = useMemo(() => {
    if (list === "goals") return goalsFor(pages);
    if (list === "print") return printQueueFor(pages);
    return tasksFor(pages, list, now);
  }, [pages, list, now]);
  const counts = useMemo(() => ({ today: tasksFor(pages, "today", now).length }), [pages, now]);

  const groups = useMemo(() => groupFor(list, items, pages, now), [list, items, pages, now]);

  return (
    <div className="pl-view">
      <header className="pl-head">
        <div>
          <h1 className="pl-title">Tasks & Goals</h1>
          <p className="pl-sub">{counts.today ? `${counts.today} for today` : "All clear for today"}</p>
        </div>
        <Segmented value={list} onChange={(v) => open({ kind: "tasks", list: v })} options={LISTS} label="List" size="standard" />
      </header>

      <FocusTimerBar />

      {list === "goals" ? (
        <QuickAdd
          autoFocus
          placeholder="Add a goal — e.g. “Launch v2.0 next month”"
          onAdd={(p) =>
            createItem("goal", {
              title: p.title,
              data: { target: p.due ?? null, steps: [] },
            })
          }
        />
      ) : list === "print" ? (
        <QuickAdd
          autoFocus
          placeholder="Add to print queue — e.g. “Print contract 2 copies tomorrow”"
          onAdd={(p) =>
            createItem("requirement", {
              title: p.title,
              data: { due: p.due ?? now, print: true, copies: 1, colorMode: "bw", doubleSided: false },
            })
          }
        />
      ) : list !== "done" ? (
        <QuickAdd
          autoFocus
          placeholder={list === "someday" ? "Add an idea for someday" : "Add a task — try “Send invoice friday 10am !!”"}
          onAdd={(p) =>
            createItem("task", {
              title: p.title,
              data: {
                due: p.due ?? (list === "today" ? now : null),
                time: p.time,
                priority: p.priority,
                someday: list === "someday" && !p.due,
              },
            })
          }
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState icon="checklist" title={EMPTY[list].title} text={EMPTY[list].text} />
      ) : list === "goals" ? (
        <div className="pl-list">
          {items.map((g) => {
            const gd = dataOf(g, "goal");
            const pct = Math.round(goalFraction(gd) * 100);
            return (
              <button
                key={g.id}
                className="res-card"
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 16px", textAlign: "left", cursor: "pointer", marginBottom: 8 }}
                onClick={() => openPage(g.id)}
              >
                <span style={{ fontSize: 18 }}>🎯</span>
                <div style={{ flex: 1 }}>
                  <div className="bidi" style={{ fontWeight: 600 }}>{pageTitle(g)}</div>
                  {gd.target && <div style={{ fontSize: 12, opacity: 0.7 }}>Target: {relDay(gd.target)}</div>}
                </div>
                <div style={{ width: 120, height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "#3b82f6" }} />
                </div>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, minWidth: 38, textAlign: "right" }}>{pct}%</span>
              </button>
            );
          })}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="pl-group">
            <GroupHead title={g.title} count={g.items.length} tone={g.tone} />
            <div className="pl-list">
              {g.items.map((p) => (
                <ItemRow key={p.id} p={p} showParent={list !== "all"} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

interface Group {
  key: string;
  title: string;
  tone?: string;
  items: PageMeta[];
}

function groupFor(list: TaskListId, items: PageMeta[], pages: Record<string, PageMeta>, now: string): Group[] {
  if (list === "today") {
    const overdue = items.filter((p) => (dataOf(p, "task").due ?? now) < now);
    const due = items.filter((p) => (dataOf(p, "task").due ?? now) >= now);
    return [
      ...(overdue.length ? [{ key: "overdue", title: "Overdue", tone: "is-overdue", items: overdue }] : []),
      ...(due.length ? [{ key: "today", title: "Today", items: due }] : []),
    ];
  }
  if (list === "upcoming") {
    const by = new Map<string, PageMeta[]>();
    for (const p of items) {
      const d = dataOf(p, "task").due!;
      by.set(d, [...(by.get(d) ?? []), p]);
    }
    return [...by.entries()].map(([d, ps]) => ({ key: d, title: relDay(d), items: ps }));
  }
  if (list === "print") {
    const toPrint = items.filter((p) => !dataOf(p, "requirement").ready);
    const printed = items.filter((p) => !!dataOf(p, "requirement").ready);
    return [
      ...(toPrint.length ? [{ key: "to-print", title: "To Print", items: toPrint }] : []),
      ...(printed.length ? [{ key: "printed", title: "Printed / Ready", items: printed }] : []),
    ];
  }
  if (list === "all") {
    const by = new Map<string, PageMeta[]>();
    for (const p of items) {
      const k = p.parentId && pages[p.parentId] && !pages[p.parentId].deletedAt ? p.parentId : "";
      by.set(k, [...(by.get(k) ?? []), p]);
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : pageTitle(pages[a]).localeCompare(pageTitle(pages[b]))))
      .map(([k, ps]) => ({ key: k || "none", title: k ? pageTitle(pages[k]) : "No project", items: ps }));
  }
  return [{ key: list, title: list === "done" ? "Completed" : "Someday", items }];
}
