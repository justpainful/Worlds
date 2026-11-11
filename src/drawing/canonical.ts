/** Scene operations shared by desktop reconciliation and the authoritative Worker.
 * Independent additions can be rebased. Existing-object edits retain their
 * revision precondition so two people cannot silently overwrite one another. */
import { appendOperation } from "./operations";
import {
  validateScene,
  type Change,
  type DrawingDocument,
  type DrawingOperation,
  type DrawingScene,
  type EditOperation,
  type SceneList,
} from "./model";
import { drawingJson, DrawingWireError, type DrawingPrecondition } from "./wire";
import { checkPixelGuard } from "./pixelGuard";
const lists = { frameOrder: "frames", layerOrder: "layers", nodeOrder: "nodes", stepOrder: "steps" } as const;
const unsafe = new Set(["__proto__", "constructor", "prototype"]);
export function validateDrawingDocument(value: unknown): asserts value is DrawingDocument {
  const d = value as DrawingDocument;
  if (
    !d ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 0 ||
    !Array.isArray(d.operations) ||
    d.operations.length !== d.revision ||
    d.operations.length > 100000
  )
    throw new DrawingWireError("invalid", "Invalid drawing journal");
  validateScene(d.seed);
  validateScene(d.scene);
  let replayed: DrawingDocument = { revision: 0, seed: d.seed, scene: d.seed, operations: [] };
  for (const op of d.operations) replayed = appendOperation(replayed, op);
  if (drawingJson(replayed.scene) !== drawingJson(d.scene))
    throw new DrawingWireError("invalid", "Drawing journal does not match its scene");
}
export function importedDrawing(document: DrawingDocument, localActor: string, userId: string): DrawingDocument {
  validateDrawingDocument(document);
  const imported = structuredClone(document);
  for (const op of imported.operations) op.actor = op.actor === localActor ? userId : `imported:${op.actor}`;
  // Experiments are page relationships managed separately from content history.
  delete imported.experiment;
  validateDrawingDocument(imported);
  return imported;
}
function ancestor(doc: DrawingDocument, revision: number): DrawingDocument {
  if (revision === doc.revision) return doc;
  let before: DrawingDocument = { revision: 0, seed: doc.seed, scene: doc.seed, operations: [] };
  for (const op of doc.operations.slice(0, revision)) before = appendOperation(before, op);
  return before;
}
function appendOnlyOrder(scene: DrawingScene, change: Extract<Change, { type: "order" }>, puts: Map<string, Set<string>>): boolean {
  const prior = scene[change.list];
  return (
    Array.isArray(prior) &&
    Array.isArray(change.ids) &&
    prior.every((key, i) => change.ids[i] === key) &&
    change.ids.slice(prior.length).every((key) => puts.get(lists[change.list])?.has(key))
  );
}
/** Produces the operation to record at the server's current revision. */
export function canonicalOperation(
  doc: DrawingDocument,
  input: DrawingOperation,
  actor: string,
  preconditions?: DrawingPrecondition[],
): DrawingOperation {
  if (input && "requiresBase" in input && input.type !== "edit") throw new DrawingWireError("invalid", "Invalid strict drawing base");
  if (input?.type === "edit" && input.requiresBase !== undefined) {
    if (input.requiresBase !== true) throw new DrawingWireError("invalid", "Invalid strict drawing base");
    if (input.base !== doc.revision)
      throw new DrawingWireError("conflict", "The drawing changed after this source was captured. Keep the edit for recovery.");
  }
  if (input?.type === "edit" && input.pixelGuard !== undefined) {
    try {
      checkPixelGuard(doc.scene, input.pixelGuard);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid pixel source guard";
      throw new DrawingWireError(message.startsWith("conflict:") ? "conflict" : "invalid", message);
    }
  }
  if (
    !input ||
    input.actor !== actor ||
    !actor ||
    typeof input.id !== "string" ||
    !input.id ||
    input.id.length > 160 ||
    unsafe.has(input.id) ||
    !Number.isSafeInteger(input.base) ||
    input.base < 0 ||
    input.base > doc.revision
  )
    throw new DrawingWireError("invalid", "Invalid drawing operation author, identifier or revision");
  if (input.type === "edit" && input.versionRestore && input.base !== doc.revision)
    throw new DrawingWireError("conflict", "The shared drawing changed after the version restore preview. Keep the local edit for review.");
  if (preconditions !== undefined) return conditionalDrawingOperation(doc, input, actor, preconditions);
  if (input.base === doc.revision) {
    appendOperation(doc, input, actor);
    return structuredClone(input);
  }
  if (input.type === "toggle") {
    const next = { ...input, base: doc.revision };
    appendOperation(doc, next, actor);
    return next;
  }
  const before = ancestor(doc, input.base);
  appendOperation(before, input, actor);
  const puts = new Map<string, Set<string>>(),
    orders = new Set<SceneList>();
  for (const c of input.changes) {
    if (c.type === "put") {
      if (Object.hasOwn(doc.scene[c.collection], c.id) || puts.get(c.collection)?.has(c.id))
        throw new DrawingWireError("conflict", "A drawing element identifier already exists");
      const ids = puts.get(c.collection) ?? new Set<string>();
      ids.add(c.id);
      puts.set(c.collection, ids);
    } else if (c.type !== "order")
      throw new DrawingWireError("conflict", "An existing drawing element changed elsewhere. Keep the pending edit in recovery.");
  }
  const next: EditOperation = structuredClone(input);
  next.base = doc.revision;
  for (const c of next.changes)
    if (c.type === "order") {
      if (orders.has(c.list) || !Object.hasOwn(lists, c.list) || !appendOnlyOrder(before.scene, c, puts))
        throw new DrawingWireError("conflict", "Drawing stacking changed elsewhere");
      orders.add(c.list);
      const added = c.ids.slice(before.scene[c.list].length);
      c.ids = [...doc.scene[c.list], ...added];
    }
  appendOperation(doc, next, actor);
  return next;
}
export function drawingPreconditions(scene: DrawingScene, operation: DrawingOperation): DrawingPrecondition[] {
  if (operation.type !== "edit") return [];
  return operation.changes.map((c): DrawingPrecondition => {
    if (c.type === "order") return { type: "order", list: c.list, ids: [...scene[c.list]] };
    if (c.type === "defaultFrame") return { type: "defaultFrame", id: scene.defaultFrameId };
    const map = scene[c.collection] as unknown as Record<string, Record<string, unknown>>,
      present = Object.hasOwn(map, c.id);
    if (c.type === "patch")
      return {
        type: "fields",
        collection: c.collection,
        id: c.id,
        fields: Object.fromEntries(
          Object.keys(c.fields).map((key) => {
            const has = present && Object.hasOwn(map[c.id], key);
            return [key, { present: has, ...(has ? { value: structuredClone(map[c.id][key]) } : {}) }];
          }),
        ),
      };
    return { type: "entity", collection: c.collection, id: c.id, present, ...(present ? { value: structuredClone(map[c.id]) } : {}) };
  });
}
function conditionalDrawingOperation(
  doc: DrawingDocument,
  input: DrawingOperation,
  actor: string,
  before: DrawingPrecondition[],
): DrawingOperation {
  if (!Array.isArray(before) || before.length !== (input.type === "edit" ? input.changes.length : 0))
    throw new DrawingWireError("invalid", "Missing drawing change preconditions");
  const next = structuredClone(input);
  next.base = doc.revision;
  if (next.type === "edit") {
    const puts = new Map<string, Set<string>>();
    for (const c of next.changes)
      if (c.type === "put") {
        const keys = puts.get(c.collection) ?? new Set<string>();
        keys.add(c.id);
        puts.set(c.collection, keys);
      }
    for (let i = 0; i < next.changes.length; i++) {
      const c = next.changes[i],
        p = before[i];
      let matches = false;
      if (c.type === "order" && p?.type === "order" && c.list === p.list && Array.isArray(p.ids)) {
        const fake = { ...doc.scene, [c.list]: p.ids };
        if (appendOnlyOrder(fake, c, puts)) {
          c.ids = [...doc.scene[c.list], ...c.ids.slice(p.ids.length)];
          matches = true;
        } else matches = drawingJson(doc.scene[c.list]) === drawingJson(p.ids);
      } else if (c.type === "defaultFrame") matches = p?.type === "defaultFrame" && doc.scene.defaultFrameId === p.id;
      else if (c.type !== "order") {
        const map = doc.scene[c.collection] as unknown as Record<string, Record<string, unknown>>,
          present = Object.hasOwn(map, c.id);
        if (c.type === "patch" && p?.type === "fields" && c.collection === p.collection && c.id === p.id && p.fields && present) {
          matches =
            drawingJson(Object.keys(c.fields).sort()) === drawingJson(Object.keys(p.fields).sort()) &&
            Object.entries(p.fields).every(
              ([key, expected]) =>
                expected &&
                Object.hasOwn(map[c.id], key) === expected.present &&
                (!expected.present || drawingJson(map[c.id][key]) === drawingJson(expected.value)),
            );
        } else if (
          p?.type === "entity" &&
          c.collection === p.collection &&
          c.id === p.id &&
          (c.type === "put"
            ? !p.present && !present
            : present === p.present && (!present || drawingJson(map[c.id]) === drawingJson(p.value)))
        )
          matches = true;
      }
      if (!matches)
        throw new DrawingWireError(
          "conflict",
          "A property used by this drawing edit changed elsewhere. Your edit is retained for recovery.",
        );
    }
  }
  appendOperation(doc, next, actor);
  return next;
}
/** Existing state and structural order require an expiring fenced lease. */
export function drawingLeaseTargets(doc: DrawingDocument, operation: DrawingOperation): string[] {
  const targets = new Set<string>(),
    puts = new Map<string, Set<string>>();
  if (operation.type === "edit" && operation.versionRestore) targets.add("drawing:root");
  if (operation.type === "edit" && operation.requiresBase) targets.add("drawing:root");
  if (operation.type === "edit" && operation.pixelGuard)
    for (const layer of [...operation.pixelGuard.expected.layers, ...(operation.pixelGuard.expected.ancestors ?? [])])
      targets.add(`layer:${layer.id}`);
  const target =
    operation.type === "toggle"
      ? doc.operations.find((op): op is EditOperation => op.id === operation.target && op.type === "edit")
      : undefined;
  if (target?.versionRestore) targets.add("drawing:root");
  const changes = operation.type === "edit" ? operation.changes : target?.changes;
  if (!changes) throw new DrawingWireError("invalid", "Missing drawing history target");
  for (const c of changes)
    if (c.type === "put") {
      const keys = puts.get(c.collection) ?? new Set<string>();
      keys.add(c.id);
      puts.set(c.collection, keys);
    }
  const prefix = { nodes: "node", layers: "layer", frames: "frame", masks: "mask", steps: "step", assets: "asset" };
  for (const c of changes) {
    if (c.type === "patch" || c.type === "remove" || (operation.type === "toggle" && c.type === "put")) {
      if (Object.hasOwn(doc.scene[c.collection], c.id)) targets.add(`${prefix[c.collection]}:${c.id}`);
    } else if (c.type === "order") {
      const onlyAdded = appendOnlyOrder(target ? ancestor(doc, target.base).scene : doc.scene, c, puts);
      if (!onlyAdded) targets.add(`order:${c.list}`);
    } else if (c.type === "defaultFrame" && (operation.type === "toggle" || doc.scene.defaultFrameId !== c.id)) targets.add("drawing:root");
  }
  return [...targets].sort();
}

function targetParts(target: string) {
  const at = target.indexOf(":");
  return [target.slice(0, at), target.slice(at + 1)] as const;
}
function inLayer(scene: DrawingScene, layer: string, parent: string): boolean {
  let key: string | null = layer;
  const seen = new Set<string>();
  while (key && !seen.has(key)) {
    if (key === parent) return true;
    seen.add(key);
    key = scene.layers[key]?.parentId ?? null;
  }
  return false;
}
function nodeUsesMask(n: DrawingScene["nodes"][string], id: string) {
  return n.maskId === id || n.effects.some((e) => e.maskId === id);
}
function nodeUsesAsset(scene: DrawingScene, n: DrawingScene["nodes"][string], id: string) {
  return (
    n.assetId === id ||
    n.brush?.tipAssetId === id ||
    Object.values(scene.masks).some((m) => nodeUsesMask(n, m.id) && (m.assetId === id || m.strokes.some((s) => s.brush.tipAssetId === id)))
  );
}
function scopeNodes(scene: DrawingScene, target: string): string[] {
  const [kind, key] = targetParts(target);
  return Object.values(scene.nodes)
    .filter(
      (n) =>
        kind === "drawing" ||
        (kind === "node" && n.id === key) ||
        (kind === "frame" && n.frameId === key) ||
        (kind === "layer" && inLayer(scene, n.layerId, key)) ||
        (kind === "mask" && nodeUsesMask(n, key)) ||
        (kind === "asset" && nodeUsesAsset(scene, n, key)),
    )
    .map((n) => n.id);
}
export function drawingLeaseCovers(scene: DrawingScene, broad: string, narrow: string): boolean {
  if (broad === narrow || broad === "drawing:root") return true;
  const [bk, bid] = targetParts(broad),
    [nk, nid] = targetParts(narrow);
  if (nk === "order" || nk === "drawing" || bk === "order") return false;
  if (bk === "layer" && nk === "layer") return inLayer(scene, nid, bid);
  if (nk === "frame" || nk === "layer") return false;
  const narrowNodes = scopeNodes(scene, narrow),
    broadNodes = new Set(scopeNodes(scene, broad));
  return narrowNodes.length > 0 && narrowNodes.every((key) => broadNodes.has(key));
}
export function drawingLeaseOverlaps(scene: DrawingScene, a: string, b: string): boolean {
  if (drawingLeaseCovers(scene, a, b) || drawingLeaseCovers(scene, b, a)) return true;
  const nodes = new Set(scopeNodes(scene, a));
  return scopeNodes(scene, b).some((key) => nodes.has(key));
}
export function affectedDrawingTargets(doc: DrawingDocument, operation: DrawingOperation): string[] {
  const targets = new Set(drawingLeaseTargets(doc, operation));
  if (operation.type === "edit")
    for (const c of operation.changes)
      if (c.type === "put")
        targets.add(
          `${{ nodes: "node", layers: "layer", frames: "frame", masks: "mask", steps: "step", assets: "asset" }[c.collection]}:${c.id}`,
        );
  return [...targets];
}
