import { describe, expect, it } from "vitest";
import { freshId, looksLikeConceptMap, mapView, parseConceptMap, withLayout, writeConceptMap } from "./conceptMap";

const TEMPLATE = `flowchart TD
  C0(["المفهوم الأساسي"])
  C1["المفهوم الأول"]
  C2["المفهوم الثاني"]
  C3["المفهوم الثالث"]
  C4["النتيجة / الأثر"]
  C0 -->|يتكون من| C1
  C0 -->|يعتمد على| C2
  C1 -->|يؤدي إلى| C3
  C2 -->|يتفاعل مع| C3
  C3 -->|ينتج عنه| C4`;

describe("concept map", () => {
  it("reads the concept map template", () => {
    const g = parseConceptMap(TEMPLATE)!;
    expect(g.simple).toBe(true);
    expect(g.nodes.map((n) => n.id)).toEqual(["C0", "C1", "C2", "C3", "C4"]);
    expect(g.nodes[0]).toEqual({ id: "C0", label: "المفهوم الأساسي", shape: "stadium" });
    expect(g.edges).toHaveLength(5);
    expect(g.edges[0]).toEqual({ from: "C0", to: "C1", label: "يتكون من", style: "arrow" });
    expect(looksLikeConceptMap(g)).toBe(true);
    expect(mapView(g)).toBe("world");
  });

  it("reads chains, bare ids, text links and statements on one line", () => {
    const g = parseConceptMap("graph LR\n  A[Idea] --> B[Plan] --> C[Ship]; C -- feeds --> A\n  D-->E")!;
    expect(g.direction).toBe("LR");
    expect(g.simple).toBe(true);
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.label}`)).toEqual(["A>B:", "B>C:", "C>A:feeds", "D>E:"]);
    expect(g.nodes.find((n) => n.id === "D")!.label).toBe("D");
    expect(mapView(g)).toBe("diagram");
  });

  it("keeps the layout in comments and only touches those lines", () => {
    const g = parseConceptMap(TEMPLATE)!;
    g.positions.C0 = { x: 10.4, y: -20.6 };
    g.view = "world";
    const code = withLayout(TEMPLATE, g);
    expect(code.startsWith(TEMPLATE)).toBe(true);
    expect(code).toContain("%% view world");
    expect(code).toContain("%% at C0 10 -21");
    const again = parseConceptMap(code)!;
    expect(again.positions.C0).toEqual({ x: 10, y: -21 });
    expect(withLayout(code, again)).toBe(code);
  });

  it("writes a graph that reads back the same", () => {
    const g = parseConceptMap(TEMPLATE)!;
    g.nodes.push({ id: freshId(g), label: 'a "quoted" idea', shape: "round" });
    g.edges.push({ from: "C4", to: "C5", label: "يفسر", style: "dotted" });
    const back = parseConceptMap(writeConceptMap(g))!;
    expect(back.simple).toBe(true);
    expect(back.nodes).toEqual(g.nodes);
    expect(back.edges).toEqual(g.edges);
  });

  it("marks charts it cannot fully read, and ignores other diagrams", () => {
    expect(parseConceptMap("flowchart TD\n  subgraph S\n  A --> B\n  end")!.simple).toBe(false);
    expect(parseConceptMap("flowchart TD\n  A --> B\n  classDef x fill:#f00")!.simple).toBe(false);
    expect(parseConceptMap("sequenceDiagram\n  A->>B: hi")).toBeNull();
  });
});
