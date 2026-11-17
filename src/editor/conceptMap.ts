/**
 * Reads a Mermaid flowchart as a graph of concepts and links, and writes it back.
 *
 * The concept map world (ConceptWorld.tsx) shows a flowchart as a space to move
 * around in, the way Obsidian shows a vault. Where each concept sits is kept in
 * the diagram itself as Mermaid comments, so the layout travels with the page to
 * every platform and to Claude:
 *
 *     %% view world
 *     %% at C0 120 -40
 *
 * Mermaid ignores comments, so the same code still draws as a diagram.
 */

export type NodeShape = "rect" | "round" | "stadium" | "circle" | "rhombus" | "hexagon" | "subroutine" | "cylinder" | "asym";
export type EdgeStyle = "arrow" | "line" | "dotted" | "thick";
export type MapView = "world" | "diagram";

export interface MapNode {
  id: string;
  label: string;
  shape: NodeShape;
}
export interface MapEdge {
  from: string;
  to: string;
  label: string;
  style: EdgeStyle;
}
export interface ConceptGraph {
  direction: string;
  nodes: MapNode[];
  edges: MapEdge[];
  positions: Record<string, { x: number; y: number }>;
  view: MapView | null;
  /** Every statement was understood, so the world can rewrite the code without losing anything. */
  simple: boolean;
}

const SHAPES: { shape: NodeShape; open: string; close: string }[] = [
  { shape: "stadium", open: "([", close: "])" },
  { shape: "subroutine", open: "[[", close: "]]" },
  { shape: "cylinder", open: "[(", close: ")]" },
  { shape: "circle", open: "((", close: "))" },
  { shape: "hexagon", open: "{{", close: "}}" },
  { shape: "asym", open: ">", close: "]" },
  { shape: "round", open: "(", close: ")" },
  { shape: "rect", open: "[", close: "]" },
  { shape: "rhombus", open: "{", close: "}" },
];

const HEADER = /^\s*(flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?\s*;?\s*$/i;
const ID = /^\s*([\p{L}\p{N}_][\p{L}\p{N}_]*)/u;
// -->, ---, ==>, ===, -.->, -.-, <-->, --x, --o, with an optional |label|.
const OP = /^\s*(<?)(-\.+-|--+|==+)(>|x|o)?\s*(?:\|([^|]*)\|)?/;
// -- label --> and -- label ---, == label ==>
const TEXT_OP = /^\s*(--|==|-\.)\s+([^|]+?)\s+(-->|---|==>|===|-\.->|-\.-)/;

function unquote(text: string): string {
  const t = text.trim();
  const q = t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
  return q.replace(/#quot;/g, '"').replace(/#lt;/g, "<").replace(/#gt;/g, ">").replace(/#35;/g, "#");
}

/** One node reference: an id, and maybe its shape and label. */
function readNode(src: string): { node: MapNode; labelled: boolean; rest: string } | null {
  const m = ID.exec(src);
  if (!m) return null;
  let rest = src.slice(m[0].length);
  const id = m[1];
  for (const s of SHAPES) {
    if (!rest.startsWith(s.open)) continue;
    let body = rest.slice(s.open.length);
    let label: string;
    if (body.trimStart().startsWith('"')) {
      const start = body.indexOf('"'),
        end = body.indexOf('"', start + 1);
      if (end < 0) return null;
      label = body.slice(start + 1, end);
      body = body.slice(end + 1);
      const close = body.indexOf(s.close);
      if (close < 0 || body.slice(0, close).trim()) return null;
      rest = body.slice(close + s.close.length);
    } else {
      const close = body.indexOf(s.close);
      if (close < 0) return null;
      label = body.slice(0, close);
      rest = body.slice(close + s.close.length);
    }
    rest = rest.replace(/^:::[\w-]+/, "");
    return { node: { id, label: unquote(label), shape: s.shape }, labelled: true, rest };
  }
  rest = rest.replace(/^:::[\w-]+/, "");
  return { node: { id, label: id, shape: "rect" }, labelled: false, rest };
}

function readOp(src: string): { style: EdgeStyle; label: string; rest: string } | null {
  const t = TEXT_OP.exec(src);
  if (t) {
    const style: EdgeStyle = t[1] === "==" ? "thick" : t[1] === "-." ? "dotted" : t[3].endsWith(">") ? "arrow" : "line";
    return { style, label: unquote(t[2]), rest: src.slice(t[0].length) };
  }
  const m = OP.exec(src);
  if (!m) return null;
  const body = m[2],
    style: EdgeStyle = body.startsWith("=") ? "thick" : body.includes(".") ? "dotted" : m[3] ? "arrow" : "line";
  return { style, label: unquote(m[4] ?? ""), rest: src.slice(m[0].length) };
}

export function parseConceptMap(code: string): ConceptGraph | null {
  const lines = code.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith("%%"))) i++;
  const head = HEADER.exec(lines[i] ?? "");
  if (!head) return null;
  const graph: ConceptGraph = { direction: (head[2] ?? "TD").toUpperCase(), nodes: [], edges: [], positions: {}, view: null, simple: true };
  const byId = new Map<string, MapNode>();
  const note = (n: MapNode, labelled: boolean) => {
    const known = byId.get(n.id);
    if (!known) {
      byId.set(n.id, n);
      graph.nodes.push(n);
    } else if (labelled) {
      known.label = n.label;
      known.shape = n.shape;
    }
  };
  for (const raw of lines.slice(0, i)) readComment(raw, graph);
  for (const raw of lines.slice(i + 1)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("%%")) {
      readComment(line, graph);
      continue;
    }
    for (const statement of statements(line)) {
      let rest = statement;
      if (!rest.trim()) continue;
      const first = readNode(rest);
      if (!first) {
        graph.simple = false;
        break;
      }
      note(first.node, first.labelled);
      rest = first.rest;
      let from = first.node.id;
      while (rest.trim()) {
        const op = readOp(rest);
        if (!op) break;
        const next = readNode(op.rest);
        if (!next) {
          rest = op.rest;
          graph.simple = false;
          break;
        }
        note(next.node, next.labelled);
        graph.edges.push({ from, to: next.node.id, label: op.label, style: op.style });
        from = next.node.id;
        rest = next.rest;
      }
      if (rest.trim()) graph.simple = false;
    }
  }
  // Keywords that read like node ids (subgraph, end, classDef, style, click...) mean more is going on than concepts and links.
  if (graph.nodes.some((n) => /^(subgraph|end|classDef|class|style|linkStyle|click|direction)$/i.test(n.id))) graph.simple = false;
  for (const id of Object.keys(graph.positions)) if (!byId.has(id)) delete graph.positions[id];
  return graph;
}

/** A line split at the semicolons that end statements, not those inside a "label" or an entity like #quot; */
function statements(line: string): string[] {
  const out: string[] = [];
  let quoted = false,
    start = 0;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (ch === '"') quoted = !quoted;
    else if (ch === ";" && !quoted && !/#[a-z0-9]+$/i.test(line.slice(start, k))) {
      out.push(line.slice(start, k));
      start = k + 1;
    }
  }
  out.push(line.slice(start));
  return out;
}

function readComment(line: string, graph: ConceptGraph) {
  const t = line.trim();
  const view = /^%%\s*view\s+(world|diagram)\s*$/i.exec(t);
  if (view) graph.view = view[1].toLowerCase() as MapView;
  const at = /^%%\s*at\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/i.exec(t);
  if (at) graph.positions[at[1]] = { x: Number(at[2]), y: Number(at[3]) };
}

/** A concept map is a flowchart whose links mostly carry a linking phrase. */
export function looksLikeConceptMap(graph: ConceptGraph): boolean {
  if (!graph.edges.length) return false;
  return graph.edges.filter((e) => e.label.trim()).length * 2 >= graph.edges.length;
}

export function mapView(graph: ConceptGraph): MapView {
  return graph.view ?? (looksLikeConceptMap(graph) ? "world" : "diagram");
}

const escapeLabel = (label: string) => label.replace(/"/g, "#quot;").replace(/\n/g, " ");

function opText(edge: MapEdge): string {
  const body = edge.style === "thick" ? "==>" : edge.style === "dotted" ? "-.->" : edge.style === "line" ? "---" : "-->";
  return edge.label.trim() ? `${body}|${escapeLabel(edge.label.trim()).replace(/\|/g, "/")}|` : body;
}

/** The whole graph as Mermaid code; use only when the graph is simple. */
export function writeConceptMap(graph: ConceptGraph): string {
  const out = [`flowchart ${graph.direction}`];
  for (const n of graph.nodes) {
    const s = SHAPES.find((x) => x.shape === n.shape) ?? SHAPES[7];
    out.push(`  ${n.id}${s.open}"${escapeLabel(n.label)}"${s.close}`);
  }
  for (const e of graph.edges) out.push(`  ${e.from} ${opText(e)} ${e.to}`);
  return out.join("\n") + layoutLines(graph);
}

function layoutLines(graph: ConceptGraph): string {
  const extra: string[] = [];
  if (graph.view) extra.push(`%% view ${graph.view}`);
  for (const n of graph.nodes) {
    const p = graph.positions[n.id];
    if (p) extra.push(`%% at ${n.id} ${Math.round(p.x)} ${Math.round(p.y)}`);
  }
  return extra.length ? "\n" + extra.join("\n") : "";
}

/** Only the layout comments change; every other line stays exactly as written. */
export function withLayout(code: string, graph: Pick<ConceptGraph, "view" | "positions" | "nodes">): string {
  const kept = code
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/^\s*%%\s*(view|at)\s/i.test(l));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.join("\n") + layoutLines({ direction: "", edges: [], simple: true, ...graph });
}

/** An id that is not used yet, like C5. */
export function freshId(graph: ConceptGraph, prefix = "C"): string {
  const used = new Set(graph.nodes.map((n) => n.id));
  let k = graph.nodes.length;
  while (used.has(`${prefix}${k}`)) k++;
  return `${prefix}${k}`;
}
