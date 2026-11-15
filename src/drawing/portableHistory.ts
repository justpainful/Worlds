import type { DrawingDocument, DrawingScene } from "./model";
import { appendOperation } from "./operations";
import { validateDrawingDocument } from "./canonical";
import { drawingJson } from "./wire";
export const MAX_PORTABLE_HISTORY_OPERATIONS = 500;
export const MAX_PORTABLE_HISTORY_BYTES = 64 * 1024 * 1024;
export function validatePortableHistory(document: DrawingDocument) {
  if (!document || typeof document !== "object" || !Array.isArray(document.operations)) throw new Error("Invalid portable history");
  if (
    document.operations.length > MAX_PORTABLE_HISTORY_OPERATIONS ||
    new TextEncoder().encode(JSON.stringify(document)).length > MAX_PORTABLE_HISTORY_BYTES
  )
    throw new Error("Portable history exceeds 500 operations or 64 MiB");
  validateDrawingDocument(document);
}
function visitAttachments(doc: DrawingDocument, visit: (id: string) => string) {
  const scene = (s: DrawingScene) => {
    for (const a of Object.values(s.assets)) a.attachmentId = visit(a.attachmentId);
  };
  scene(doc.seed);
  scene(doc.scene);
  for (const op of doc.operations)
    if (op.type === "edit") {
      for (const c of op.changes)
        if (c.type === "put" && c.collection === "assets") {
          const asset = c.value as DrawingScene["assets"][string];
          asset.attachmentId = visit(asset.attachmentId);
        } else if (c.type === "patch" && c.collection === "assets" && typeof c.fields.attachmentId === "string")
          c.fields.attachmentId = visit(c.fields.attachmentId);
      for (const asset of Object.values(op.pixelGuard?.expected.assets ?? {})) asset.attachmentId = visit(asset.attachmentId);
    }
}
export function historyAttachmentIds(doc: DrawingDocument): string[] {
  const ids = new Set<string>();
  visitAttachments(structuredClone(doc), (id) => {
    ids.add(id);
    return id;
  });
  return [...ids];
}
export function rewriteHistoryAttachments(doc: DrawingDocument, map: ReadonlyMap<string, string>): DrawingDocument {
  const result = structuredClone(doc);
  visitAttachments(result, (id) => {
    const next = map.get(id);
    if (!next) throw new Error("The portable history is missing an original");
    return next;
  });
  return result;
}
export function historySourceScenes(doc: DrawingDocument): DrawingScene[] {
  const scenes = [doc.seed];
  let replay: DrawingDocument = { revision: 0, seed: doc.seed, scene: doc.seed, operations: [] },
    bytes = new TextEncoder().encode(JSON.stringify(doc.seed)).length;
  for (const op of doc.operations) {
    replay = appendOperation(replay, op);
    const encoded = new TextEncoder().encode(JSON.stringify(replay.scene)).length;
    bytes += encoded;
    if (bytes > 32 * 1024 * 1024) throw new Error("History source checks exceed 32 MiB. Export without history.");
    scenes.push(replay.scene);
  }
  return scenes;
}
export function historyVersionIds(doc: DrawingDocument): string[] {
  const ids = new Set<string>();
  const scan = (s: DrawingScene) => {
    for (const step of Object.values(s.steps)) if (step.pinnedVersionId) ids.add(step.pinnedVersionId);
  };
  scan(doc.seed);
  scan(doc.scene);
  for (const op of doc.operations)
    if (op.type === "edit") {
      if (op.versionRestore) {
        ids.add(op.versionRestore.versionId);
        ids.add(op.versionRestore.backupId);
      }
      for (const c of op.changes)
        if (c.type === "put" && c.collection === "steps") {
          const id = (c.value as DrawingScene["steps"][string]).pinnedVersionId;
          if (id) ids.add(id);
        } else if (c.type === "patch" && c.collection === "steps" && typeof c.fields.pinnedVersionId === "string")
          ids.add(c.fields.pinnedVersionId);
    }
  return [...ids];
}
export function remapPortableHistory(
  doc: DrawingDocument,
  versions: ReadonlyMap<string, string>,
  operations: ReadonlyMap<string, string> = new Map(doc.operations.map((op) => [op.id, crypto.randomUUID()])),
): DrawingDocument {
  const result = structuredClone(doc);
  delete result.seed.libraryPublication;
  delete result.scene.libraryPublication;
  const remapScene = (s: DrawingScene) => {
    for (const step of Object.values(s.steps))
      if (step.pinnedVersionId) {
        const id = versions.get(step.pinnedVersionId);
        if (!id) throw new Error("Missing portable history version");
        step.pinnedVersionId = id;
      }
  };
  remapScene(result.seed);
  remapScene(result.scene);
  for (const op of result.operations) {
    const old = op.id;
    op.id = operations.get(old)!;
    if (op.type === "toggle") op.target = operations.get(op.target) ?? op.target;
    else {
      if (op.versionRestore) {
        op.versionRestore.versionId = versions.get(op.versionRestore.versionId) ?? op.versionRestore.versionId;
        op.versionRestore.backupId = op.id;
      }
      for (const c of op.changes)
        if (c.type === "put" && c.collection === "steps") {
          const step = c.value as DrawingScene["steps"][string];
          if (step.pinnedVersionId) step.pinnedVersionId = versions.get(step.pinnedVersionId) ?? step.pinnedVersionId;
        } else if (c.type === "patch" && c.collection === "steps" && typeof c.fields.pinnedVersionId === "string")
          c.fields.pinnedVersionId = versions.get(c.fields.pinnedVersionId) ?? c.fields.pinnedVersionId;
    }
  }
  delete result.experiment;
  validatePortableHistory(result);
  return result;
}
export function portableScenesMatch(a: DrawingScene, b: DrawingScene, reference: (id: string) => string) {
  const normal = (s: DrawingScene) => {
    const c = structuredClone(s);
    for (const asset of Object.values(c.assets)) asset.attachmentId = reference(asset.attachmentId);
    return drawingJson(c);
  };
  return normal(a) === normal(b);
}
