import type { PageMeta } from "../lib/types";
import { anchorPoint, bounds, localToWorld } from "./geometry";
import { id, newScene, validateScene, type Brush, type DrawingNode, type DrawingScene, type Paint, type Point, type TextStyle } from "./model";
import { translateWorldMask } from "./workflows";
export type LibraryKind = "brush" | "palette" | "elements" | "style" | "frame" | "template" | "signature";
export interface LibraryPayload { brush?: Brush; colors?: string[]; style?: { paint: Paint; textStyle: TextStyle } }
export interface LibraryMetadata { name: string; kind: LibraryKind; tags: string[]; payload: LibraryPayload }
export interface LibraryItem {
  sourceState?:'available'|'missing'|'denied';
  syncStatus?:'local'|'pending'|'synced'|'offline'|'conflict'|'denied';
  page: PageMeta; kind: LibraryKind; tags: string[]; sourceId: string | null; owner: string;
  version: number; scope: "personal" | "workspace"; workspaceId: string | null; canEdit: boolean; canDelete: boolean;
  versions: { version: number; createdAt: number; author: string }[];
}
export interface LibraryPublication { item: LibraryItem; version: number; scene: DrawingScene; payload: LibraryPayload }
export interface LibraryPublish extends LibraryMetadata {
  sourceId: string; itemId?: string; expectedVersion?: number; scope: "personal" | "workspace"; scene: DrawingScene;
}
export function validateLibraryMetadata(value: unknown, scene: DrawingScene): asserts value is LibraryMetadata {
  const m = value as LibraryMetadata;
  if (!m || typeof m.name !== "string" || !m.name.trim() || m.name.length > 160 || !["brush", "palette", "elements", "style", "frame", "template", "signature"].includes(m.kind) || !Array.isArray(m.tags) || m.tags.length > 24 || m.tags.some((tag) => typeof tag !== "string" || tag.length > 64) || !m.payload || typeof m.payload !== "object" || JSON.stringify(m.payload).length > 65536) throw new Error("Invalid drawing library metadata");
  if (m.kind === "palette" && (!Array.isArray(m.payload.colors) || !m.payload.colors.length || m.payload.colors.length > 256 || m.payload.colors.some((c) => !/^#[\da-f]{6}([\da-f]{2})?$/i.test(c)))) throw new Error("Invalid library palette");
  if (m.kind === "brush") {
    const probe = structuredClone(scene), brush = m.payload.brush;
    if (!brush) throw new Error("Missing library brush");
    const sample = { x: 0, y: 0, pressure: 1, tiltX: 0, tiltY: 0, time: 0 };
    const node: DrawingNode = { id: "library-brush-check", kind: "stroke", layerId: scene.layerOrder[0], frameId: scene.defaultFrameId, name: "Brush", groupId: null, visible: true, locked: false, rotation: 0, opacity: 1, flipX: false, flipY: false, x: 0, y: 0, w: 10, h: 10, brush, samples: [sample], effects: [], paint: { fill: "transparent", stroke: "#000000", strokeWidth: 1, dash: [], cap: "round", radius: 0 }, textStyle: { font: "sans-serif", size: 12, weight: 400, italic: false, align: "start", direction: "auto", leading: 1, background: "transparent", color: "#000000", border: "transparent" } };
    probe.nodes[node.id] = node; probe.nodeOrder.push(node.id); validateScene(probe);
    if (brush.tipAssetId && !scene.assets[brush.tipAssetId]) throw new Error("Missing brush tip original");
  }
  if (m.kind === "style") {
    if(!m.payload.style||Object.keys(m.payload.style).length!==2||Object.keys(m.payload.style).some(key=>!['paint','textStyle'].includes(key)))throw new Error('Invalid library style fields');
    const prototype = Object.values(scene.nodes)[0];
    if (!prototype || JSON.stringify(m.payload.style?.paint) !== JSON.stringify(prototype.paint) || JSON.stringify(m.payload.style?.textStyle) !== JSON.stringify(prototype.textStyle)) throw new Error("Invalid library style preview");
  }
}

/** Capture only selected material and its transitive masks/originals. External
 * annotations become independent points at the original visible location. */
export function captureLibraryScene(scene: DrawingScene, kind: LibraryKind, selected: string[], frameId: string, brush?: Brush): DrawingScene {
  if (kind === "template") {const copy=structuredClone(scene);delete copy.libraryPublication;return copy;}
  const result = newScene(), frame = scene.frames[frameId] ?? scene.frames[scene.defaultFrameId];
  const nodeIds = new Set(kind === "frame" ? scene.nodeOrder.filter((key) => scene.nodes[key].frameId === frame.id) : selected.filter((key) => scene.nodes[key]));
  if (["elements", "style", "signature"].includes(kind) && !nodeIds.size) throw new Error("Select drawing elements first");
  const layerIds = new Set([...nodeIds].map((key) => scene.nodes[key].layerId));
  if (kind === "frame" && !layerIds.size) layerIds.add(scene.layerOrder.find((key) => scene.layers[key].libraryInstanceId === frame.libraryInstanceId) ?? scene.layerOrder[0]);
  const instanceIds = new Set(kind === "frame" && frame.libraryInstanceId ? [frame.libraryInstanceId] : [...nodeIds].map((key) => scene.nodes[key].libraryInstanceId));
  const canonical = instanceIds.size === 1 && !instanceIds.has(undefined) ? new Map([...nodeIds].map((key) => [key, scene.nodes[key].librarySourceNodeId ?? key])) : new Map<string, string>();
  for (const lid of [...layerIds]) { let parent = scene.layers[lid].parentId; while (parent) { layerIds.add(parent); parent = scene.layers[parent].parentId; } }
  const canonicalLayers = new Map([...layerIds].map((key) => [key, canonical.size && scene.layers[key].libraryInstanceId === [...instanceIds][0] ? scene.layers[key].librarySourceLayerId ?? key : key]));
  if (layerIds.size) { result.layers = Object.fromEntries(scene.layerOrder.filter((key) => layerIds.has(key)).map((key) => { const l = structuredClone(scene.layers[key]), lid = canonicalLayers.get(key)!; l.id = lid; l.parentId = l.parentId ? canonicalLayers.get(l.parentId)! : null; delete l.libraryInstanceId; delete l.librarySourceLayerId; return [lid, l]; })); result.layerOrder = scene.layerOrder.filter((key) => layerIds.has(key)).map((key) => canonicalLayers.get(key)!); }
  result.frames = { [frame.id]: structuredClone(frame) }; result.frameOrder = [frame.id]; result.defaultFrameId = frame.id;
  for (const key of scene.nodeOrder.filter((key) => nodeIds.has(key))) {
    const n = structuredClone(scene.nodes[key]); n.frameId = frame.id; n.id = canonical.get(key) ?? key; n.layerId = canonicalLayers.get(n.layerId) ?? n.layerId;
    delete n.libraryItemId; delete n.libraryVersion; delete n.libraryInstanceId; delete n.librarySourceNodeId;
    for (const a of ["anchor", "endAnchor"] as const) if (n[a]?.nodeId) { const anchor = n[a]!; n[a] = nodeIds.has(anchor.nodeId!) ? { ...anchor, nodeId: canonical.get(anchor.nodeId!) ?? anchor.nodeId } : { ...anchor, nodeId: null, fallback: anchorPoint(scene, anchor).point }; }
    result.nodes[n.id] = n; result.nodeOrder.push(n.id);
  }
  const maskIds = new Set(Object.values(result.nodes).flatMap((n) => [n.maskId, ...n.effects.map((e) => e.maskId)].filter((key): key is string => !!key)));
  result.masks = Object.fromEntries([...maskIds].map((key) => [key, structuredClone(scene.masks[key])]));
  const assetIds = new Set([...Object.values(result.nodes).flatMap((n) => [n.assetId, n.brush?.tipAssetId]), ...Object.values(result.masks).flatMap((m) => [m.assetId, ...m.strokes.map((s) => s.brush.tipAssetId)]), brush?.tipAssetId].filter((key): key is string => !!key));
  result.assets = Object.fromEntries([...assetIds].map((key) => [key, structuredClone(scene.assets[key])]));
  if (kind === "frame") { result.steps = Object.fromEntries(scene.stepOrder.filter((key) => scene.steps[key].frameId === frame.id).map((key) => [key, structuredClone(scene.steps[key])])); result.stepOrder = scene.stepOrder.filter((key) => result.steps[key]); }
  else if (nodeIds.size) { const b = bounds(Object.values(result.nodes).flatMap((n) => [{ x: 0, y: 0 }, { x: n.w, y: 0 }, { x: n.w, y: n.h }, { x: 0, y: n.h }].map((p) => localToWorld(n, p))), 20); result.frames[frame.id] = { ...frame, ...b, background: "transparent" }; }
  if (kind === "frame" && frame.librarySourceFrameId) {
    const fid = frame.librarySourceFrameId, saved = result.frames[frame.id]; delete result.frames[frame.id]; saved.id = fid;
    delete saved.libraryInstanceId; delete saved.librarySourceFrameId; delete saved.libraryItemId; delete saved.libraryVersion;
    result.frames[fid] = saved; result.defaultFrameId = fid; result.frameOrder = [fid];
    for (const n of Object.values(result.nodes)) n.frameId = fid;
    const steps: DrawingScene["steps"] = {};
    for (const key of result.stepOrder) { const s = result.steps[key], sid = s.librarySourceStepId ?? key; s.id = sid; s.frameId = fid; s.hiddenNodeIds = s.hiddenNodeIds.map((id) => canonical.get(id) ?? id); delete s.libraryInstanceId; delete s.librarySourceStepId; steps[sid] = s; }
    result.stepOrder = result.stepOrder.map((key) => result.steps[key].id); result.steps = steps;
  }
  validateScene(result); return result;
}

export function insertLibraryScene(target: DrawingScene, publication: LibraryPublication, position: Point, targetFrameId: string, linked: boolean, replacingInstance?: string): { scene: DrawingScene; selected: string[] } {
  const source = publication.scene, next = structuredClone(target), kind = publication.item.kind;
  const existing = replacingInstance ? Object.values(next.nodes).filter((n) => n.libraryInstanceId === replacingInstance && n.libraryItemId === publication.item.page.id) : [];
  const insertionIndex = existing.length ? Math.min(...existing.map((n) => next.nodeOrder.indexOf(n.id))) : next.nodeOrder.length;
  const frame = source.frames[source.defaultFrameId], oldFrame = replacingInstance ? Object.values(next.frames).find((f) => f.libraryInstanceId === replacingInstance && f.librarySourceFrameId === frame.id) : undefined;
  const origin = oldFrame ?? (existing.length ? { x: Math.min(...existing.map((n) => n.x)), y: Math.min(...existing.map((n) => n.y)) } : position);
  const offset = { x: origin.x - (!oldFrame && existing.length && source.nodeOrder.length ? Math.min(...Object.values(source.nodes).map((n) => n.x)) : frame.x), y: origin.y - (!oldFrame && existing.length && source.nodeOrder.length ? Math.min(...Object.values(source.nodes).map((n) => n.y)) : frame.y) };
  const remap = new Map<string, string>(), mapId = (key: string) => { let v = remap.get(key); if (!v) { v = id(); remap.set(key, v); } return v; };
  for (const n of existing) { if (n.librarySourceNodeId) remap.set(n.librarySourceNodeId, n.id); delete next.nodes[n.id]; }
  if (replacingInstance) {
    for (const f of Object.values(next.frames)) if (f.libraryInstanceId === replacingInstance && f.librarySourceFrameId && source.frames[f.librarySourceFrameId]) remap.set(f.librarySourceFrameId, f.id);
    for (const l of Object.values(next.layers)) if (l.libraryInstanceId === replacingInstance && l.librarySourceLayerId && source.layers[l.librarySourceLayerId]) remap.set(l.librarySourceLayerId, l.id);
    for (const s of Object.values(next.steps)) if (s.libraryInstanceId === replacingInstance) { if (s.librarySourceStepId && source.steps[s.librarySourceStepId]) remap.set(s.librarySourceStepId, s.id); delete next.steps[s.id]; }
    next.stepOrder = next.stepOrder.filter((key) => next.steps[key]);
  }
  next.nodeOrder = next.nodeOrder.filter((key) => next.nodes[key]);
  const copyFrame = kind === "frame" || kind === "template";
  for (const key of source.frameOrder) mapId(key);
  for (const key of source.layerOrder) mapId(key);
  for (const key of source.nodeOrder) mapId(key);
  for (const key of Object.keys(source.assets)) mapId(key);
  for (const key of Object.keys(source.masks)) mapId(key);
  for (const key of source.stepOrder) mapId(key);
  for (const asset of Object.values(source.assets)) { const aid = mapId(asset.id); next.assets[aid] = { ...structuredClone(asset), id: aid }; }
  for (const mask of Object.values(source.masks)) { const mid = mapId(mask.id), m = translateWorldMask(mask, offset); m.id = mid; if (m.assetId) m.assetId = mapId(m.assetId); for (const stroke of m.strokes) if (stroke.brush.tipAssetId) stroke.brush.tipAssetId = mapId(stroke.brush.tipAssetId); next.masks[mid] = m; }
  const instance = replacingInstance ?? id(), selected: string[] = [];
  if (copyFrame) for (const key of source.frameOrder) { const f = source.frames[key], fid = mapId(key); next.frames[fid] = { ...f, id: fid, x: f.x + offset.x, y: f.y + offset.y, libraryInstanceId: linked ? instance : undefined, librarySourceFrameId: linked ? key : undefined, libraryItemId: linked ? publication.item.page.id : undefined, libraryVersion: linked ? publication.version : undefined }; if (!next.frameOrder.includes(fid)) next.frameOrder.push(fid); }
  for (const key of source.layerOrder) { const l = source.layers[key], lid = mapId(key); next.layers[lid] = { ...structuredClone(l), id: lid, parentId: l.parentId ? mapId(l.parentId) : null, libraryInstanceId: linked ? instance : undefined, librarySourceLayerId: linked ? key : undefined }; if (!next.layerOrder.includes(lid)) next.layerOrder.push(lid); }
  for (const key of source.nodeOrder) {
    const n = structuredClone(source.nodes[key]); n.id = mapId(key); n.x += offset.x; n.y += offset.y; n.layerId = mapId(n.layerId); n.frameId = copyFrame && n.frameId ? mapId(n.frameId) : targetFrameId;
    if (n.groupId) n.groupId = mapId(n.groupId);
    if (n.annotationGroup) n.annotationGroup = mapId(`annotation:${n.annotationGroup}`);
    if (n.assetId) n.assetId = mapId(n.assetId); if (n.maskId) n.maskId = mapId(n.maskId); if (n.brush?.tipAssetId) n.brush.tipAssetId = mapId(n.brush.tipAssetId);
    n.effects = n.effects.map((e) => ({ ...e, id: id(), maskId: e.maskId ? mapId(e.maskId) : undefined }));
    for (const a of ["anchor", "endAnchor"] as const) if (n[a]) { const anchor = n[a]!; n[a] = { ...anchor, nodeId: anchor.nodeId && source.nodes[anchor.nodeId] ? mapId(anchor.nodeId) : null, fallback: { x: anchor.fallback.x + offset.x, y: anchor.fallback.y + offset.y } }; }
    if (linked) { n.libraryItemId = publication.item.page.id; n.libraryVersion = publication.version; n.libraryInstanceId = instance; n.librarySourceNodeId = key; }
    else { delete n.libraryItemId; delete n.libraryVersion; delete n.libraryInstanceId; delete n.librarySourceNodeId; }
    next.nodes[n.id] = n; selected.push(n.id);
  }
  next.nodeOrder.splice(insertionIndex, 0, ...selected);
  if (copyFrame) for (const key of source.stepOrder) { const step = structuredClone(source.steps[key]); step.id = mapId(key); step.frameId = mapId(step.frameId); step.camera.x += offset.x; step.camera.y += offset.y; step.hiddenNodeIds = step.hiddenNodeIds.map(mapId); step.libraryInstanceId = linked ? instance : undefined; step.librarySourceStepId = linked ? key : undefined; next.steps[step.id] = step; next.stepOrder.push(step.id); }
  if (replacingInstance) {
    for (const f of Object.values(next.frames)) if (f.libraryInstanceId === replacingInstance && f.librarySourceFrameId && !source.frames[f.librarySourceFrameId]) {
      if (f.id !== next.defaultFrameId && !Object.values(next.nodes).some((n) => n.frameId === f.id) && !Object.values(next.steps).some((s) => s.frameId === f.id)) delete next.frames[f.id];
      else { delete f.libraryInstanceId; delete f.librarySourceFrameId; delete f.libraryItemId; delete f.libraryVersion; }
    }
    next.frameOrder = next.frameOrder.filter((key) => next.frames[key]);
    for (const key of [...next.layerOrder].reverse()) { const l = next.layers[key]; if (l.libraryInstanceId === replacingInstance && l.librarySourceLayerId && !source.layers[l.librarySourceLayerId]) {
      if (Object.keys(next.layers).length > 1 && !Object.values(next.nodes).some((n) => n.layerId === key) && !Object.values(next.layers).some((child) => child.parentId === key)) delete next.layers[key];
      else { delete l.libraryInstanceId; delete l.librarySourceLayerId; }
    } }
    next.layerOrder = next.layerOrder.filter((key) => next.layers[key]);
  }
  validateScene(next); return { scene: next, selected };
}
export function detachLibraryInstance(scene: DrawingScene, instance: string): DrawingScene {
  const next = structuredClone(scene);
  for (const n of Object.values(next.nodes)) if (n.libraryInstanceId === instance) { delete n.libraryItemId; delete n.libraryVersion; delete n.libraryInstanceId; delete n.librarySourceNodeId; }
  for (const f of Object.values(next.frames)) if (f.libraryInstanceId === instance) { delete f.libraryItemId; delete f.libraryVersion; delete f.libraryInstanceId; delete f.librarySourceFrameId; }
  for (const l of Object.values(next.layers)) if (l.libraryInstanceId === instance) { delete l.libraryInstanceId; delete l.librarySourceLayerId; }
  for (const s of Object.values(next.steps)) if (s.libraryInstanceId === instance) { delete s.libraryInstanceId; delete s.librarySourceStepId; }
  return next;
}
