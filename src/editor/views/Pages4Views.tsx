import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Icon } from "../../ui/Icon";
import { menuAt } from "../../ui/Menu";

// ---------------------------------------------------------------------------
// Math (KaTeX)
// ---------------------------------------------------------------------------

function renderTex(latex: string, display: boolean): { html: string; error: string | null } {
  try {
    return { html: katex.renderToString(latex || "\\square", { displayMode: display, throwOnError: true, strict: "ignore", trust: false, output: "htmlAndMathml" }), error: null };
  } catch (e) {
    return { html: katex.renderToString(latex || "\\square", { displayMode: display, throwOnError: false, strict: "ignore", trust: false }), error: e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : String(e) };
  }
}

function MathEditor({ value, display, onDone, onCancel }: { value: string; display: boolean; onDone: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const r = renderTex(v, display);
  return (
    <span className={`math-edit ${display ? "is-display" : ""}`} contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="math-input"
        dir="ltr"
        spellCheck={false}
        rows={display ? 3 : 1}
        value={v}
        placeholder={display ? "\\int_0^1 x^2\\,dx = \\frac{1}{3}" : "e^{i\\pi} + 1 = 0"}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (!display || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onDone(v);
          }
        }}
        onBlur={() => onDone(v)}
      />
      <span className="math-preview" dangerouslySetInnerHTML={{ __html: r.html }} />
      {r.error && <span className="math-error">{r.error}</span>}
      <span className="math-hint">{display ? "Ctrl+Enter to finish" : "Enter to finish"}</span>
    </span>
  );
}

export function MathInlineView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const latex = node.attrs.latex as string;
  const [editing, setEditing] = useState(!latex);
  const { html, error } = useMemo(() => renderTex(latex, false), [latex]);
  return (
    <NodeViewWrapper as="span" className={`math-inline ${selected ? "is-selected" : ""} ${error ? "has-error" : ""}`}>
      {editing ? (
        <MathEditor
          value={latex}
          display={false}
          onDone={(v) => {
            setEditing(false);
            if (!v.trim()) deleteNode();
            else if (v !== latex) updateAttributes({ latex: v });
          }}
          onCancel={() => (latex ? setEditing(false) : deleteNode())}
        />
      ) : (
        <span className="math-render" title={error ?? latex} onDoubleClick={() => setEditing(true)} onClick={() => selected && setEditing(true)} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </NodeViewWrapper>
  );
}

export function MathBlockView({ node, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const latex = node.attrs.latex as string;
  const [editing, setEditing] = useState(!latex);
  const { html, error } = useMemo(() => renderTex(latex, true), [latex]);
  return (
    <NodeViewWrapper className={`math-block ${selected ? "is-selected" : ""}`} data-drag-handle>
      {editing ? (
        <MathEditor
          value={latex}
          display
          onDone={(v) => {
            setEditing(false);
            if (!v.trim()) deleteNode();
            else if (v !== latex) updateAttributes({ latex: v });
          }}
          onCancel={() => (latex ? setEditing(false) : deleteNode())}
        />
      ) : (
        <div className="math-block-render" onDoubleClick={() => setEditing(true)} contentEditable={false}>
          <div dangerouslySetInnerHTML={{ __html: html }} />
          {error && <div className="math-error">{error}</div>}
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: m }) => {
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      fontFamily: "Instrument Sans Variable, IBM Plex Sans Arabic, system-ui, sans-serif",
      themeVariables: { background: "transparent", primaryColor: "#2a2a30", primaryTextColor: "#f4f2ee", lineColor: "#8b8d98", primaryBorderColor: "#55555e" },
    });
    return m;
  });
  return mermaidReady;
}
let mermaidSeq = 0;

export function MermaidView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const code = node.attrs.code as string;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const source = editing ? draft : code;

  useEffect(() => {
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const m = await loadMermaid();
        const { svg } = await m.render(`mmd-${++mermaidSeq}`, source);
        if (live) {
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : String(e));
        document.querySelectorAll('[id^="dmmd-"]').forEach((n) => n.remove());
      }
    }, editing ? 300 : 0);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [source, editing]);

  return (
    <NodeViewWrapper className={`mermaid-block ${selected ? "is-selected" : ""}`} data-drag-handle contentEditable={false}>
      <div className="mermaid-bar">
        <span className="mermaid-label"><Icon name="layers" size={13} /> Diagram</span>
        <span className="grow" />
        <button
          className="chip-btn"
          onClick={() => {
            if (editing && draft !== code) updateAttributes({ code: draft });
            setDraft(code);
            setEditing(!editing);
          }}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {editing && (
        <textarea
          className="mermaid-code"
          dir="ltr"
          spellCheck={false}
          value={draft}
          rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onBlur={() => draft !== code && updateAttributes({ code: draft })}
        />
      )}
      {error ? <div className="mermaid-error">{error}</div> : <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} onDoubleClick={() => setEditing(true)} />}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Charts from tables
// ---------------------------------------------------------------------------

interface TableData {
  bid: string;
  header: string[];
  rows: string[][];
}

const PALETTE = ["#7fa7d9", "#d2a46e", "#8db39a", "#d98c9a", "#b49ad9", "#e0c36a", "#6fc2c2", "#d08560"];

function cellText(cell: PMNode) {
  return cell.textContent.trim();
}

/** Every top-level table on the page, as header + rows of text. */
function tablesIn(doc: PMNode): TableData[] {
  const out: TableData[] = [];
  doc.forEach((n) => {
    if (n.type.name !== "table" || !n.attrs.bid) return;
    const rows: string[][] = [];
    n.forEach((row) => {
      const cells: string[] = [];
      row.forEach((c) => cells.push(cellText(c)));
      rows.push(cells);
    });
    if (rows.length) out.push({ bid: n.attrs.bid as string, header: rows[0], rows: rows.slice(1) });
  });
  return out;
}

/** "1,250", "35%", "$40", "١٢" all count as numbers. */
function num(s: string): number | null {
  const western = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,\s%$€£¥]/g, "");
  if (!western) return null;
  const n = Number(western);
  return Number.isFinite(n) ? n : null;
}

export function ChartView({ node, updateAttributes, editor, getPos, selected }: ReactNodeViewProps) {
  const a = node.attrs as { source: string; kind: "bar" | "line" | "pie" | "area"; title: string; labelColumn: number; valueColumns: number[] | null };
  const [rev, setRev] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  // Redraw as the page (and so the table) changes.
  useEffect(() => {
    const bump = () => setRev((r) => r + 1);
    editor.on("update", bump);
    return () => {
      editor.off("update", bump);
    };
  }, [editor]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tables = useMemo(() => tablesIn(editor.state.doc), [editor, rev]);
  // No source yet: use the nearest table above the chart, and remember it.
  const pos = typeof getPos === "function" ? getPos() : undefined;
  const fallback = useMemo(() => {
    if (a.source || pos === undefined) return null;
    let found: string | null = null;
    editor.state.doc.forEach((n, offset) => {
      if (offset < pos && n.type.name === "table" && n.attrs.bid) found = n.attrs.bid as string;
    });
    return found ?? tables[0]?.bid ?? null;
  }, [a.source, pos, editor, tables]);
  useEffect(() => {
    if (!a.source && fallback) updateAttributes({ source: fallback });
  }, [a.source, fallback, updateAttributes]);

  const table = tables.find((t) => t.bid === (a.source || fallback));
  const numericCols = table ? table.header.map((_, i) => i).filter((i) => i !== a.labelColumn && table.rows.some((r) => num(r[i] ?? "") !== null)) : [];
  const valueCols = (a.valueColumns ?? numericCols).filter((i) => numericCols.includes(i));
  const labels = table ? table.rows.map((r) => r[a.labelColumn] ?? "") : [];
  const series = table ? valueCols.map((c) => ({ name: table.header[c] || `Column ${c + 1}`, values: table.rows.map((r) => num(r[c] ?? "") ?? 0) })) : [];

  const kinds: { id: typeof a.kind; label: string }[] = [
    { id: "bar", label: "Bars" },
    { id: "line", label: "Lines" },
    { id: "area", label: "Area" },
    { id: "pie", label: "Pie" },
  ];

  return (
    <NodeViewWrapper className={`chart-block ${selected ? "is-selected" : ""}`} data-drag-handle contentEditable={false}>
      <div className="chart-bar">
        <input className="chart-title bidi" dir="auto" placeholder="Chart" defaultValue={a.title} onBlur={(e) => e.target.value !== a.title && updateAttributes({ title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        <span className="grow" />
        <div className="chart-kinds">
          {kinds.map((k) => (
            <button key={k.id} className={`chip-btn ${a.kind === k.id ? "is-on" : ""}`} onClick={() => updateAttributes({ kind: k.id })}>{k.label}</button>
          ))}
        </div>
        <button
          className="chip-btn"
          disabled={!tables.length}
          onClick={(e) =>
            menuAt(e.currentTarget, [
              { kind: "label", label: "Data from" },
              ...tables.map((t, i) => ({ label: `Table ${i + 1}: ${t.header.slice(0, 3).join(", ")}`, checked: t.bid === table?.bid, onSelect: () => updateAttributes({ source: t.bid, valueColumns: null }) })),
              ...(table
                ? [
                    { kind: "label" as const, label: "Labels" },
                    ...table.header.map((h, i) => ({ label: h || `Column ${i + 1}`, checked: i === a.labelColumn, onSelect: () => updateAttributes({ labelColumn: i, valueColumns: null }) })),
                    { kind: "label" as const, label: "Values" },
                    ...numericCols.map((i) => ({
                      label: table.header[i] || `Column ${i + 1}`,
                      checked: valueCols.includes(i),
                      onSelect: () => {
                        const next = valueCols.includes(i) ? valueCols.filter((c) => c !== i) : [...valueCols, i].sort((x, y) => x - y);
                        updateAttributes({ valueColumns: next.length ? next : null });
                      },
                    })),
                  ]
                : []),
            ])
          }
        >
          <Icon name="table" size={13} /> Data
        </button>
      </div>
      <div className="chart-stage" ref={box}>
        {!table ? (
          <div className="chart-empty">Add a table to this page (first row = headings, then numbers) and the chart draws itself from it.</div>
        ) : !series.length ? (
          <div className="chart-empty">The table has no numbers yet.</div>
        ) : a.kind === "pie" ? (
          <PieChart labels={labels} values={series[0].values} width={width} />
        ) : (
          <XYChart labels={labels} series={series} kind={a.kind} width={width} />
        )}
      </div>
      {series.length > 1 && a.kind !== "pie" && (
        <div className="chart-legend">
          {series.map((s, i) => (
            <span key={s.name}><i style={{ background: PALETTE[i % PALETTE.length] }} />{s.name}</span>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function fmt(v: number) {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : String(Math.round(v * 100) / 100);
}

function XYChart({ labels, series, kind, width }: { labels: string[]; series: { name: string; values: number[] }[]; kind: "bar" | "line" | "area"; width: number }) {
  const H = 260;
  const pad = { l: 44, r: 12, t: 12, b: 34 };
  const w = Math.max(240, width) - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const all = series.flatMap((s) => s.values);
  const max = niceMax(Math.max(0, ...all));
  const min = Math.min(0, ...all);
  const range = max - min || 1;
  const y = (v: number) => pad.t + h - ((v - min) / range) * h;
  const n = Math.max(1, labels.length);
  const step = w / n;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * range);
  return (
    <svg width={Math.max(240, width)} height={H} className="chart-svg" role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} className="chart-grid" />
          <text x={pad.l - 8} y={y(t) + 4} className="chart-tick" textAnchor="end">{fmt(t)}</text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text key={i} x={pad.l + step * i + step / 2} y={H - 12} className="chart-tick" textAnchor="middle">
          {l.length > 12 ? `${l.slice(0, 11)}…` : l}
        </text>
      ))}
      {kind === "bar"
        ? series.map((s, si) => {
            const bw = Math.max(2, (step * 0.72) / series.length);
            return s.values.map((v, i) => {
              const x = pad.l + step * i + step * 0.14 + bw * si;
              const top = Math.min(y(v), y(0));
              return <rect key={`${si}-${i}`} x={x} y={top} width={bw - 2} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={3} fill={PALETTE[si % PALETTE.length]}><title>{`${labels[i]}: ${v}`}</title></rect>;
            });
          })
        : series.map((s, si) => {
            const pts = s.values.map((v, i) => [pad.l + step * i + step / 2, y(v)] as const);
            const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
            const color = PALETTE[si % PALETTE.length];
            return (
              <g key={si}>
                {kind === "area" && <path d={`${d} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`} fill={color} opacity={0.22} />}
                <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill={color}><title>{`${labels[i]}: ${s.values[i]}`}</title></circle>
                ))}
              </g>
            );
          })}
    </svg>
  );
}

function PieChart({ labels, values, width }: { labels: string[]; values: number[]; width: number }) {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  const size = Math.min(240, Math.max(160, width * 0.4));
  const r = size / 2 - 6;
  let a0 = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const frac = Math.max(0, v) / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number) => [size / 2 + r * Math.cos(a), size / 2 + r * Math.sin(a)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    const d = frac >= 0.9999 ? `M${size / 2},${size / 2 - r} a${r},${r} 0 1,1 0,${2 * r} a${r},${r} 0 1,1 0,${-2 * r}` : `M${size / 2},${size / 2} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
    a0 = a1;
    return { d, color: PALETTE[i % PALETTE.length], label: labels[i], value: v, pct: Math.round(frac * 1000) / 10 };
  });
  return (
    <div className="chart-pie">
      <svg width={size} height={size} role="img">
        {slices.map((s, i) => (
          <path key={i} d={s.d} fill={s.color} stroke="var(--surface-deep, #1c1c1f)" strokeWidth={2}><title>{`${s.label}: ${s.value} (${s.pct}%)`}</title></path>
        ))}
      </svg>
      <ul className="chart-pie-legend">
        {slices.map((s, i) => (
          <li key={i}><i style={{ background: s.color }} /><span className="bidi">{s.label}</span><b>{s.pct}%</b></li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function TabsView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  const titles: string[] = [];
  node.forEach((c) => titles.push((c.attrs.title as string) || "Tab"));
  const active = Math.min(node.attrs.active as number, titles.length - 1);
  const body = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<number | null>(null);

  // Only the chosen tab's panel shows (CSS keyed on data-active, so it holds
  // however and whenever the editor mounts the panels).

  const childPos = (i: number) => {
    const base = (getPos() ?? 0) + 1;
    let offset = 0;
    for (let k = 0; k < i; k++) offset += node.child(k).nodeSize;
    return base + offset;
  };
  const rename = (i: number, title: string) => {
    const pos = childPos(i);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.child(i).attrs, title: title.trim() || "Tab" }));
  };
  const addTab = () => {
    const end = (getPos() ?? 0) + node.nodeSize - 1;
    const tab = editor.schema.nodes.tab.create({ title: `Tab ${titles.length + 1}` }, editor.schema.nodes.paragraph.create());
    editor.view.dispatch(editor.state.tr.insert(end, tab));
    updateAttributes({ active: titles.length });
  };
  const removeTab = (i: number) => {
    if (titles.length < 2) return;
    const pos = childPos(i);
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.child(i).nodeSize));
    updateAttributes({ active: Math.max(0, Math.min(active, titles.length - 2)) });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= titles.length) return;
    const from = childPos(Math.min(i, j));
    const a = node.child(Math.min(i, j));
    const b = node.child(Math.max(i, j));
    editor.view.dispatch(editor.state.tr.replaceWith(from, from + a.nodeSize + b.nodeSize, [b, a]));
    updateAttributes({ active: j });
  };

  return (
    <NodeViewWrapper className="tabs-view" data-active={active}>
      <div className="tabs-strip" contentEditable={false} role="tablist">
        {titles.map((t, i) =>
          renaming === i ? (
            <input
              key={i}
              className="tabs-rename bidi"
              dir="auto"
              autoFocus
              defaultValue={t}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={(e) => {
                rename(i, e.target.value);
                setRenaming(null);
              }}
            />
          ) : (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              className={`tabs-tab ${i === active ? "is-active" : ""}`}
              onClick={() => i !== active && updateAttributes({ active: i })}
              onDoubleClick={() => setRenaming(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                menuAt(e.currentTarget, [
                  { label: "Rename", icon: "edit", onSelect: () => setRenaming(i) },
                  { label: "Move Left", icon: "arrowLeft", disabled: i === 0, onSelect: () => move(i, -1) },
                  { label: "Move Right", icon: "arrowRight", disabled: i === titles.length - 1, onSelect: () => move(i, 1) },
                  { kind: "separator" },
                  { label: "Delete Tab", icon: "delete", danger: true, disabled: titles.length < 2, onSelect: () => removeTab(i) },
                ]);
              }}
            >
              <span className="bidi">{t}</span>
            </button>
          ),
        )}
        <button className="tabs-add" aria-label="Add tab" data-tip="Add tab" onClick={addTab}>
          <Icon name="add" size={14} />
        </button>
      </div>
      <div ref={body} className="tabs-body">
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}
