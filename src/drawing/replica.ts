import type { DrawingDocument, DrawingOperation } from "./model";
import type { DrawingPrecondition, DrawingWireState, DrawingWireVersion } from "./wire";
import type { DrawingExportRules } from "./exportPolicy";
export interface DrawingReplica {
  pageId: string; document: DrawingDocument; basis: DrawingDocument; remote: DrawingWireState | null;
  pending: { operation: DrawingOperation; preconditions: DrawingPrecondition[] }[];
  versions: Record<string, DrawingWireVersion>; attachmentIds: string[]; localActor: string; userId: string;
  workspaceId: string; serverUrl: string; level: "none" | "view" | "comment" | "edit" | "full";
  status: "pending" | "synced" | "offline" | "conflict" | "denied"; error: string | null;
  exportPolicy?: DrawingExportRules;
}
export type DrawingCheckpointResult = { status: "retry" | "conflict" } | { status: "accepted"; document: DrawingDocument };
