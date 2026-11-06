import { id, newScene, validateScene, type Change, type DrawingDocument, type DrawingOperation, type DrawingScene, type EditOperation } from "./model";
import { anchorPoint } from "./geometry";
import { checkPixelGuard } from "./pixelGuard";

const MAPS = new Set(["frames", "layers", "nodes", "assets", "masks", "steps"]);
const LISTS = new Set(["frameOrder", "layerOrder", "nodeOrder", "stepOrder"]);
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
export function newDrawing(): DrawingDocument {
  const seed = newScene();
  return { revision: 0, seed, scene: structuredClone(seed), operations: [] };
}
export function edit(actor: string, base: number, label: string, changes: Change[]): EditOperation {
  return { id: id(), actor, base, at: Date.now(), label, type: "edit", changes: JSON.parse(JSON.stringify(changes)) as Change[] };
}
export function applyChanges(scene: DrawingScene, changes: Change[], replaying = false): DrawingScene {
  const next = structuredClone(scene);
  if (!Array.isArray(changes) || changes.length > 10000) throw new Error("The drawing operation is too large");
  for (const c of changes) {
    if (c.type === "order") {
      if (!LISTS.has(c.list) || !Array.isArray(c.ids)) throw new Error("Invalid drawing order");
      const map = { frameOrder: "frames", layerOrder: "layers", nodeOrder: "nodes", stepOrder: "steps" } as const;
      const entities = next[map[c.list]];
      next[c.list] = replaying ? [...c.ids.filter((k) => Object.hasOwn(entities, k)), ...Object.keys(entities).filter((k) => !c.ids.includes(k)).sort()] : [...c.ids];
    } else if (c.type === "defaultFrame") next.defaultFrameId = c.id;
    else {
      if (!MAPS.has(c.collection) || typeof c.id !== "string" || UNSAFE.has(c.id)) throw new Error("Invalid drawing entity");
      const m = next[c.collection] as unknown as Record<string, unknown>;
      if (c.type === "remove") delete m[c.id];
      else if (c.type === "put") {
        if (Object.hasOwn(m, c.id)) throw new Error("This element already exists");
        m[c.id] = structuredClone(c.value);
      } else if (c.type === "patch") {
        if (!Object.hasOwn(m, c.id)) throw new Error("The element changed or was removed");
        if (!c.fields || Object.keys(c.fields).some((k) => UNSAFE.has(k) || k === "id")) throw new Error("Invalid element fields");
        m[c.id] = { ...(m[c.id] as object), ...structuredClone(c.fields) };
      } else throw new Error("Unknown drawing operation");
    }
  }
  return next;
}
export function enabledOperations(ops: DrawingOperation[]): Map<string, boolean> {
  const enabled = new Map<string, boolean>();
  for (const op of ops) {
    if (op.type === "edit") enabled.set(op.id, true);
    else enabled.set(op.target, op.enabled);
  }
  return enabled;
}

/** Replay operations, never restore an old flattened layer over another author's work. */
export function replay(seed: DrawingScene, ops: DrawingOperation[]): DrawingScene {
  const enabled = enabledOperations(ops);
  let scene = structuredClone(seed);
  for (const op of ops) if (op.type === "edit" && enabled.get(op.id)) scene = applyChanges(scene, op.changes, true);
  validateScene(scene);
  return scene;
}
export function appendOperation(doc: DrawingDocument, op: DrawingOperation, actor = op.actor): DrawingDocument {
  if('requiresBase' in op&&op.type!=='edit')throw new Error('Invalid strict drawing base');
  if(op.type==='edit'&&op.requiresBase!==undefined&&op.requiresBase!==true)throw new Error('Invalid strict drawing base');
  if (!["edit", "toggle"].includes(op.type) || !Number.isInteger(op.base) || op.base < 0) throw new Error("Invalid drawing operation type or revision");
  if (op.actor !== actor || !actor || !op.id || !Number.isFinite(op.at) || !op.label?.trim()) throw new Error("Invalid drawing author or operation");
  if (op.type === "edit" && op.versionRestore !== undefined) {
    const r = op.versionRestore;
    if (!r || typeof r.versionId !== "string" || !r.versionId || r.versionId.length > 160 || UNSAFE.has(r.versionId) || r.backupId !== op.id || r.expectedRevision !== op.base) throw new Error("Invalid version restore receipt");
  }
  const existing = doc.operations.find((p) => p.id === op.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(op)) throw new Error("Operation identifier was reused");
    return doc;
  }
  if (op.base !== doc.revision) throw new Error("conflict: the drawing changed; keep this edit in a recovered copy");
  if(op.type==="edit"&&op.pixelGuard!==undefined)checkPixelGuard(doc.scene,op.pixelGuard);
  if (op.type === "toggle") {
    const target = doc.operations.find((p) => p.id === op.target);
    if (!target || target.type !== "edit" || target.actor !== actor || typeof op.enabled !== "boolean") throw new Error("Only the author can undo this operation");
  }
  const operations = [...doc.operations, structuredClone(op)];
  const scene = op.type === "edit" ? applyChanges(doc.scene, op.changes) : replay(doc.seed, operations);
  validateScene(scene);
  return { ...doc, revision: doc.revision + 1, scene, operations };
}

/** Restore/import through the same validated transaction as every ordinary edit. */
export function sceneChanges(before: DrawingScene, after: DrawingScene): Change[] {
  validateScene(after);
  const changes: Change[] = [];
  for (const collection of ["frames", "layers", "nodes", "assets", "masks", "steps"] as const) {
    const old = before[collection] as unknown as Record<string, Record<string, unknown>>;
    const next = after[collection] as unknown as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(old)) if (!Object.hasOwn(next, key)) changes.push({ type: "remove", collection, id: key });
    for (const [key, value] of Object.entries(next)) {
      if (!Object.hasOwn(old, key)) changes.push({ type: "put", collection, id: key, value });
      else {
        const fields: Record<string, unknown> = {};
        for (const field of new Set([...Object.keys(old[key]), ...Object.keys(value)])) {
          if (field !== "id" && JSON.stringify(old[key][field]) !== JSON.stringify(value[field])) fields[field] = value[field] ?? null;
        }
        if (Object.keys(fields).length) changes.push({ type: "patch", collection, id: key, fields });
      }
    }
  }
  for (const list of ["frameOrder", "layerOrder", "nodeOrder", "stepOrder"] as const) changes.push({ type: "order", list, ids: after[list] });
  changes.push({ type: "defaultFrame", id: after.defaultFrameId });
  return changes;
}

export function historyToggle(doc: DrawingDocument, actor: string, redo = false): DrawingOperation | null {
  const enabled = enabledOperations(doc.operations);
  const edits = doc.operations.filter((p): p is EditOperation => p.type === "edit" && p.actor === actor);
  let target = [...edits].reverse().find((p) => enabled.get(p.id) === true);
  if (redo) {
    target = undefined;
    for (const op of [...doc.operations].reverse()) {
      if (op.actor !== actor) continue;
      if (op.type === "edit") break;
      if (!op.enabled && enabled.get(op.target) === false) { target = edits.find((p) => p.id === op.target); break; }
    }
  }
  return target ? { id: id(), actor, base: doc.revision, at: Date.now(), label: redo ? "Redo" : "Undo", type: "toggle", target: target.id, enabled: redo } : null;
}

/** Create or delete atomically with the scene's stable ordering index. */
export function putNode(scene: DrawingScene, node: DrawingScene["nodes"][string]): Change[] {
  return [{ type: "put", collection: "nodes", id: node.id, value: node }, { type: "order", list: "nodeOrder", ids: [...scene.nodeOrder, node.id] }];
}
export function removeNodes(scene: DrawingScene, ids: string[]): Change[] {
  const set = new Set(ids);
  const anchors: Change[] = [];
  for (const node of Object.values(scene.nodes).filter((n) => !set.has(n.id))) {
    const fields: Record<string, unknown> = {};
    for (const key of ["anchor", "endAnchor"] as const) { const anchor = node[key]; if (anchor?.nodeId && set.has(anchor.nodeId)) fields[key] = { ...anchor, fallback: anchorPoint(scene, anchor).point }; }
    if (Object.keys(fields).length) anchors.push({ type: "patch", collection: "nodes", id: node.id, fields });
  }
  return [...anchors, ...ids.map((id): Change => ({ type: "remove", collection: "nodes", id })), { type: "order", list: "nodeOrder", ids: scene.nodeOrder.filter((n) => !set.has(n)) }];
}
