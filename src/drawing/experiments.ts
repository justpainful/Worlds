import { duplicateElements } from "./workflows";
import { validateScene, type DrawingScene, type EntityMap } from "./model";
export type AdoptionChoice = "current" | "experiment" | "duplicate";
export interface ExperimentDifference { key: string; collection: EntityMap | "scene"; id: string; path: string[]; base: unknown; current: unknown; experiment: unknown; conflict: boolean }
const MAPS: EntityMap[] = ["frames", "layers", "nodes", "assets", "masks", "steps"];
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const unsafe = (k: string) => ["__proto__", "constructor", "prototype"].includes(k);
export function experimentDifferences(base: DrawingScene, current: DrawingScene, experiment: DrawingScene, versionAliases: Record<string, string> = {}): ExperimentDifference[] {
  const out: ExperimentDifference[] = [];
  for (const collection of MAPS) {
    const a = base[collection] as unknown as Record<string, unknown>, b = current[collection] as unknown as Record<string, unknown>, c = experiment[collection] as unknown as Record<string, unknown>;
    for (const id of new Set([...Object.keys(a), ...Object.keys(c)])) {
      const visit = (old: unknown, mine: unknown, theirs: unknown, path: string[]) => {
        const equivalent = collection === "steps" && path.at(-1) === "pinnedVersionId" && typeof theirs === "string" ? versionAliases[theirs] ?? theirs : theirs;
        if (equal(old, equivalent) || equal(mine, equivalent)) return;
        if (plain(old) && plain(mine) && plain(theirs)) {
          for (const field of new Set([...Object.keys(old), ...Object.keys(theirs)])) {
            if (unsafe(field) || field === "id" || (collection === "assets" && field === "attachmentId")) continue;
            visit(old[field], mine[field], theirs[field], [...path, field]);
          }
        } else out.push({ key: `${collection}/${id}/${path.join("/")}`, collection, id, path, base: old, current: mine, experiment: theirs, conflict: !equal(old, mine) && !equal(mine, theirs) });
      };
      visit(a[id], b[id], c[id], []);
    }
  }
  for (const key of ["frameOrder", "layerOrder", "nodeOrder", "stepOrder", "defaultFrameId"] as const) {
    if (!equal(base[key], experiment[key]) && !equal(current[key], experiment[key])) out.push({ key: `scene/${key}`, collection: "scene", id: key, path: [key], base: base[key], current: current[key], experiment: experiment[key], conflict: !equal(base[key], current[key]) });
  }
  return out;
}
function setPath(target: Record<string, unknown>, path: string[], value: unknown) {
  if (path.some(unsafe)) throw new Error("Unsafe element property");
  let object = target;
  for (const key of path.slice(0, -1)) {
    const next = Object.hasOwn(object, key) ? object[key] : undefined;
    if (!plain(next)) object[key] = {};
    object = object[key] as Record<string, unknown>;
  }
  const key = path.at(-1)!;
  if (value === undefined) delete object[key]; else object[key] = structuredClone(value);
}
export function mergeExperiment(current: DrawingScene, experiment: DrawingScene, differences: ExperimentDifference[], choices: Record<string, AdoptionChoice>): DrawingScene {
  const next = structuredClone(current), duplicates = new Set<string>();
  for (const diff of differences) if (choices[diff.key] === "duplicate") {
    if (diff.collection !== "nodes" || !experiment.nodes[diff.id]) throw new Error("Only existing elements can be duplicated"); duplicates.add(diff.id);
  }
  for (const diff of differences) {
    const choice = choices[diff.key] ?? (diff.conflict ? undefined : "experiment");
    if (!choice) throw new Error("Resolve all experiment conflicts before adopting");
    if (choice === "current" || duplicates.has(diff.id) && diff.collection === "nodes") continue;
    if (diff.collection === "scene") { setPath(next as unknown as Record<string, unknown>, diff.path, diff.experiment); continue; }
    const map = next[diff.collection] as unknown as Record<string, unknown>;
    if (!diff.path.length) { if (diff.experiment === undefined) delete map[diff.id]; else map[diff.id] = structuredClone(diff.experiment); }
    else {
      const entity = map[diff.id]; if (!plain(entity)) throw new Error("This element was removed; resolve its conflict first");
      setPath(entity, diff.path, diff.experiment);
    }
  }
  // Import immutable dependencies of the selected elements without replacing unrelated data.
  for (const node of Object.values(next.nodes)) {
    if (!next.layers[node.layerId]) next.layers[node.layerId] = structuredClone(experiment.layers[node.layerId] ?? current.layers[node.layerId]);
    if (node.frameId && !next.frames[node.frameId]) next.frames[node.frameId] = structuredClone(experiment.frames[node.frameId] ?? current.frames[node.frameId]);
    if (node.maskId && !next.masks[node.maskId]) next.masks[node.maskId] = structuredClone(experiment.masks[node.maskId] ?? current.masks[node.maskId]);
    for(const effect of node.effects)if(effect.maskId&&!next.masks[effect.maskId]){const mask=experiment.masks[effect.maskId]??current.masks[effect.maskId];if(!mask)throw new Error("The experiment refers to a missing effect mask");next.masks[effect.maskId]=structuredClone(mask);}
  }
  const importAsset = (assetId?: string) => { if (assetId && !next.assets[assetId]) next.assets[assetId] = structuredClone(experiment.assets[assetId] ?? current.assets[assetId]); };
  for (const node of Object.values(next.nodes)) { importAsset(node.assetId); importAsset(node.brush?.tipAssetId); }
  for (const mask of Object.values(next.masks)) { importAsset(mask.assetId); for (const stroke of mask.strokes) importAsset(stroke.brush.tipAssetId); }
  if (duplicates.size) {
    const copied = duplicateElements(experiment, [...duplicates], { x: 20, y: 20 });
    for (const change of copied.changes) if (change.type === "put") (next[change.collection] as unknown as Record<string, unknown>)[change.id] = structuredClone(change.value);
    for (const node of copied.nodes) {
      if (!next.layers[node.layerId]) next.layers[node.layerId] = structuredClone(experiment.layers[node.layerId]);
      if (node.frameId && !next.frames[node.frameId]) next.frames[node.frameId] = structuredClone(experiment.frames[node.frameId]);
      importAsset(node.assetId); importAsset(node.brush?.tipAssetId);
      if (node.maskId) importAsset(next.masks[node.maskId]?.assetId);
    }
  }
  for (const layer of Object.values(next.layers)) {
    let parent = layer.parentId; const seen = new Set<string>();
    while (parent && !next.layers[parent] && !seen.has(parent)) { seen.add(parent); const ancestor = experiment.layers[parent] ?? current.layers[parent]; if (!ancestor) break; next.layers[parent] = structuredClone(ancestor); parent = ancestor.parentId; }
  }
  for (const [list, collection] of [["frameOrder", "frames"], ["layerOrder", "layers"], ["nodeOrder", "nodes"], ["stepOrder", "steps"]] as const) {
    const keys = Object.keys(next[collection]), preferred = next[list]; next[list] = [...new Set([...preferred.filter((id) => keys.includes(id)), ...current[list].filter((id) => keys.includes(id)), ...experiment[list].filter((id) => keys.includes(id)), ...keys])];
  }
  if (!next.frames[next.defaultFrameId]) next.defaultFrameId = next.frameOrder[0];
  validateScene(next); return next;
}
