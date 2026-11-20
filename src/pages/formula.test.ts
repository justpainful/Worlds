import { describe, expect, it } from "vitest";
import type { PageMeta } from "../lib/types";
import { computedProps, evaluateFormula, formulaError } from "./formula";

const page = (id: string, props: Record<string, unknown>[], title = id) =>
  ({ id, title, createdAt: 0, updatedAt: 0, properties: props.map((p, i) => ({ id: `p${i}`, ...p })) }) as unknown as PageMeta;

describe("formulas", () => {
  const task1 = page("t1", [
    { name: "Hours", type: "number", value: 3 },
    { name: "Status", type: "status", value: "Done" },
  ]);
  const task2 = page("t2", [
    { name: "Hours", type: "number", value: 5 },
    { name: "Status", type: "status", value: "In progress" },
  ]);
  const project = page("p", [
    { name: "Tasks", type: "relation", value: ["t1", "t2"] },
    { name: "Budget", type: "number", value: 10 },
    { name: "Done", type: "checkbox", value: true },
  ]);
  const pages = { t1: task1, t2: task2, p: project };

  it("does arithmetic and reads properties", () => {
    expect(evaluateFormula("Budget * 2 + 1", project, pages)).toBe(21);
    expect(evaluateFormula('prop("Budget") / 4', project, pages)).toBe(2.5);
    expect(evaluateFormula("round(10 / 3, 2)", project, pages)).toBe(3.33);
  });

  it("chooses with if and joins text", () => {
    expect(evaluateFormula('if(Done, "yes", "no")', project, pages)).toBe("yes");
    expect(evaluateFormula('"Budget: " + Budget', project, pages)).toBe("Budget: 10");
  });

  it("rolls up relations", () => {
    expect(evaluateFormula('count(prop("Tasks"))', project, pages)).toBe(2);
    expect(evaluateFormula('rollup(Tasks, "Hours", "sum")', project, pages)).toBe(8);
    expect(evaluateFormula('rollup(Tasks, "Status", "done")', project, pages)).toBe(50);
  });

  it("counts days to a date", () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const due = page("d", [{ name: "Due", type: "date", value: iso }]);
    expect(evaluateFormula('days(prop("Due"))', due, { d: due })).toBe(3);
  });

  it("reports mistakes without throwing in display", () => {
    expect(formulaError("1 +")).not.toBeNull();
    expect(formulaError('prop("A"')).not.toBeNull();
    expect(formulaError("Budget * 2")).toBeNull();
    const bad = page("b", [{ name: "F", type: "formula", formula: "nope(1)", value: null }]);
    expect(String(computedProps(bad, { b: bad })[0].value)).toMatch(/Unknown function/);
  });

  it("stops formulas that refer to each other", () => {
    const loop = page("l", [
      { name: "A", type: "formula", formula: "B + 1", value: null },
      { name: "B", type: "formula", formula: "A + 1", value: null },
    ]);
    expect(String(computedProps(loop, { l: loop })[0].value)).toMatch(/loop/);
  });
});
