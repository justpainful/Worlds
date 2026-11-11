import type { DrawingDocument, DrawingOperation, EditOperation } from "./model";
export interface DrawingHistoryWindow {
  maxEdits: number;
  maxBytes: number;
  edits: number;
  bytes: number;
  truncated: boolean;
}
export interface DrawingHistoryResult {
  document: DrawingDocument;
  operationId: string | null;
  window: DrawingHistoryWindow;
}
export interface PendingHistoryRequest {
  id: string;
  revision: number;
  actor: string;
  redo: boolean;
}
export const UNDO_MAX_EDITS = 200,
  UNDO_MAX_BYTES = 16 * 1024 * 1024;
/** Browser-development counterpart only. Native Undo queries SQLite directly. */
export function mockHistoryCandidate(
  doc: DrawingDocument,
  actor: string,
  redo: boolean,
): { target: EditOperation | null; window: DrawingHistoryWindow } {
  const own = doc.operations.filter((op): op is EditOperation => op.type === "edit" && op.actor === actor).reverse(),
    edits: EditOperation[] = [],
    encoder = new TextEncoder();
  let bytes = 0;
  for (const op of own) {
    const size = encoder.encode(JSON.stringify(op)).length;
    if (edits.length >= UNDO_MAX_EDITS || bytes + size > UNDO_MAX_BYTES) break;
    bytes += size;
    edits.push(op);
  }
  const latest = new Map<string, DrawingOperation>();
  for (const op of doc.operations) if (op.type === "toggle" && op.actor === actor) latest.set(op.target, op);
  const enabled = (id: string) => {
    const op = latest.get(id);
    return !op || op.type !== "toggle" || op.enabled;
  };
  let target: EditOperation | undefined;
  if (!redo) target = edits.find((e) => enabled(e.id));
  else {
    const newest = own[0]?.base ?? -1;
    for (const op of [...doc.operations].reverse()) {
      if (op.actor !== actor) continue;
      if (op.type === "edit" && op.base === newest) break;
      if (op.type === "toggle" && !op.enabled && !enabled(op.target)) {
        target = edits.find((e) => e.id === op.target);
        if (target) break;
      }
    }
  }
  return {
    target: target ?? null,
    window: { maxEdits: UNDO_MAX_EDITS, maxBytes: UNDO_MAX_BYTES, edits: edits.length, bytes, truncated: edits.length < own.length },
  };
}
