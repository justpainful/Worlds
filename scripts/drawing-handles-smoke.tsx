import "/src/dev/mockTauri";
import { StrictMode, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "/src/styles/tokens.css";
import "/src/styles/base.css";
import "/src/drawing/drawing.css";
import { api } from "/src/lib/api";
import { useStore } from "/src/state/store";
import { DrawingStage, type Tool } from "/src/drawing/Stage";
import { DEFAULT_BRUSH, newNode, type DrawingNode } from "/src/drawing/model";
import { drawingSession } from "/src/drawing/session";
import { edit, putNode } from "/src/drawing/operations";
import { objectTransformChanges } from "/src/drawing/objectTransforms";
import type { DrawingGestureLease } from "/src/drawing/gestureLeases";
import { gripPoint, selectionTransformFrame } from "/src/drawing/transformHandles";

if (!new URLSearchParams(location.search).has("mock")) throw Error("Explicit mock backend required");
await useStore.getState().init();
const actor = useStore.getState().profile!.id, page = await api.createPage({ title: "Synthetic handle verification", kind: "drawing" }), session = drawingSession(page.id);
useStore.getState().patchPageLocal(page); await session.flush();
const first = session.snapshot().document!, node = newNode("stroke", first.scene.layerOrder[0], first.scene.defaultFrameId, { x: 160, y: 160, w: 200, h: 100 });
node.brush = { ...DEFAULT_BRUSH, size: 18, pressureSize: false, color: "#cc3311" }; node.samples = [{ x: 20, y: 40, pressure: 0.25, tiltX: 3, tiltY: -5, time: 0 }, { x: 180, y: 60, pressure: 1, tiltX: 10, tiltY: 15, time: 20 }]; node.rotation = 20; node.flipX = true; node.seed = 42;
const other = newNode("shape", node.layerId, node.frameId, { x: 460, y: 220, w: 110, h: 80 }); other.rotation = -25; other.paint.fill = "#2277aa";
session.dispatch(edit(actor, first.revision, "Synthetic fixtures", [...putNode(first.scene, node), ...putNode({ ...first.scene, nodeOrder: [node.id] }, other)])); await session.flush();
function Harness() {
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot), scene = snapshot.document!.scene;
  const [selected, select] = useState([node.id]), [tool, setTool] = useState<Tool>("select"), [editable, setEditable] = useState(true), [waiting, setWaiting] = useState(false), [view, setView] = useState({ x: 0, y: 0, w: 1000, h: 600, scale: 1 }), [status, setStatus] = useState<string | null>(null), [record, setRecord] = useState<unknown>({ ready: true });
  const events = useRef<unknown[]>([]), gate = useRef<(() => void) | null>(null), lose = useRef<(() => void) | null>(null);
  const reject = useRef(false);
  const apply = async (before: DrawingNode[], after: DrawingNode[]) => { const current = session.snapshot().document!, changes = objectTransformChanges(current.scene, before, after); if (!changes.length) return []; const operation = edit(actor, current.revision, "Transform handles", changes); if (!session.dispatch(operation)) throw Error("Dispatch refused"); await session.flush(); return [operation.id]; };
  const begin = async (): Promise<DrawingGestureLease> => {
    if (waiting) await new Promise<void>(resolve => { gate.current = resolve; });
    let state: "locked" | "lost" = reject.current ? "lost" : "locked"; reject.current = false; const listeners = new Set<() => void>();
    lose.current = () => { state = "lost"; for (const fn of listeners) fn(); };
    return { state: () => state, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, finish: ids => { events.current.push({ finished: ids }); }, cancel: () => { events.current.push({ cancelled: true }); state = "lost"; } };
  };
  const inspect = () => { const current = session.snapshot().document!, nodes = selected.map(id => current.scene.nodes[id]); setRecord({ revision: current.revision, selected, tool, editable, status, view, nodes, originalsIntact: JSON.stringify(current.scene.nodes[node.id].samples) === JSON.stringify(node.samples), grips: Object.fromEntries(["nw", "se", "rotate"].map(grip => [grip, gripPoint(selectionTransformFrame(current.scene, nodes), grip as "nw" | "se" | "rotate", view.scale)])), events: [...events.current] }); };
  return <><div id="controls">
    <button onClick={() => { select([node.id]); setTool("select"); }}>Select stroke</button><button onClick={() => { select([node.id, other.id]); setTool("select"); }}>Select pair</button>
    <button onClick={async () => { const current = session.snapshot().document!; session.dispatch(edit(actor, current.revision, "Reset fixtures", [node,other].map(n => ({ type: "patch" as const, collection: "nodes" as const, id: n.id, fields: { x:n.x,y:n.y,w:n.w,h:n.h,rotation:n.rotation,flipX:n.flipX,flipY:n.flipY,geometrySize:null } })))); await session.flush(); }}>Reset fixtures</button>
    <button onClick={inspect}>Inspect state</button><button onClick={() => { import("/src/drawing/operations").then(({ historyToggle })=>{const undo=historyToggle(session.snapshot().document!,actor,false);if(undo)session.dispatch(undo);}); }}>Undo</button>
    <button onClick={() => setEditable(v => !v)}>Toggle editable</button><button onClick={() => setTool(tool === "select" ? "brush" : "select")}>Toggle tool</button>
    <button onClick={() => setWaiting(v => !v)}>Toggle delayed reservation</button><button onClick={() => { gate.current?.(); gate.current = null; }}>Release reservation</button><button onClick={() => lose.current?.()}>Lose reservation</button>
    <button onClick={() => { reject.current = true; gate.current?.(); gate.current = null; }}>Reject pending reservation</button>
    <button onClick={() => { const current = session.snapshot().document!, n = current.scene.nodes[node.id]; session.dispatch(edit(actor,current.revision,"Independent color",[{type:"patch",collection:"nodes",id:node.id,fields:{brush:{...n.brush!,color:"#0088ff"}}}])); }}>Change stroke color</button>
    <button onClick={() => { const current = session.snapshot().document!, n = current.scene.nodes[node.id]; session.dispatch(edit(actor,current.revision,"Concurrent geometry",[{type:"patch",collection:"nodes",id:node.id,fields:{x:n.x+1}}])); }}>Change stroke geometry</button>
    <a id="download" download="drawing-handles-checks.json" href={URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:"application/json"}))}>Download state</a>
  </div><p id="notice">Synthetic data and injected reservation states only. Pointer events and geometry use the actual production DrawingStage. {status}</p><pre id="result">{JSON.stringify(record,null,2)}</pre>
  <div id="editor"><DrawingStage scene={scene} view={view} onView={setView} onResize={(w,h)=>setView(v=>({...v,w:w/v.scale,h:h/v.scale}))} tool={tool} brush={DEFAULT_BRUSH} shape="rect" layerId={node.layerId} frameId={node.frameId!} editable={editable} selected={selected} onSelect={select} onTransform={apply} onBeginEdit={begin} onLeaseState={setStatus} onError={message=>events.current.push({error:message})} onTransformRequest={()=>events.current.push({numericRequested:true})} onObjectTransformDraft={(ids,t)=>events.current.push({draft:!!t,ids})} onMove={async()=>[]} onAdd={()=>{}} onText={()=>{}} onColor={()=>{}} onFill={()=>{}} onRegion={()=>{}} selectionKind="rect" autoShape={false} laserLifetime={1200}/></div></>;
}
createRoot(document.querySelector("#root")!).render(<StrictMode><Harness/></StrictMode>);
