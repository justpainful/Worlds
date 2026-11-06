import type { DrawingDocument, DrawingOperation, DrawingScene, EntityMap, SceneList } from "./model";
import { validateScene } from "./model";
import type { DrawingExportRules } from "./exportPolicy";
export type DrawingPrecondition =
  | { type: "entity"; collection: EntityMap; id: string; present: boolean; value?: unknown }
  | { type: "fields"; collection: EntityMap; id: string; fields: Record<string, { present: boolean; value?: unknown }> }
  | { type: "order"; list: SceneList; ids: string[] }
  | { type: "defaultFrame"; id: string };
export interface DrawingAssetInfo { sha256: string; size: number; mime: string; fileName: string }
export interface DrawingWireVersion { scene: DrawingScene; label: string; author: string; revision: number; createdAt: number }
export interface DrawingLeaseProof { target: string; token: string; fence: number }
export interface PublicDrawingLease { target: string; userId: string; deviceId: string; fence: number; expiresAt: number; mine?: boolean }
export interface DrawingDependencies { attachments: Record<string, DrawingAssetInfo>; versions: Record<string, DrawingWireVersion> }
export interface DrawingWireState extends DrawingDependencies {
  generation: string; revision: number; dependencyRevision: number; document?: DrawingDocument; operations?: DrawingOperation[];
}
export interface DrawingWireWrite extends DrawingDependencies {
  generation: string; operation?: DrawingOperation; leases?: DrawingLeaseProof[];
  preconditions?: DrawingPrecondition[];
}
export interface DrawingWireSeed extends DrawingDependencies { document: DrawingDocument; localActor: string; exportPolicy?: DrawingExportRules }
export type DrawingWireErrorCode = "invalid" | "conflict" | "lease" | "denied" | "unavailable" | "missing";
export class DrawingWireError extends Error {
  constructor(readonly code: DrawingWireErrorCode, message: string) { super(message); }
}
export const drawingWireStatus = (code: DrawingWireErrorCode) => ({ invalid: 400, conflict: 409, lease: 423, denied: 403, unavailable: 503, missing: 404 })[code];
export function validateDrawingDependencies(value: unknown): asserts value is DrawingDependencies {
  const d = value as DrawingDependencies;
  if (!d || !d.attachments || !d.versions || typeof d.attachments !== "object" || typeof d.versions !== "object" || Array.isArray(d.attachments) || Array.isArray(d.versions) || Object.keys(d.attachments).length > 100000 || Object.keys(d.versions).length > 500) throw new DrawingWireError("invalid", "Invalid drawing dependencies");
  for (const [id, info] of Object.entries(d.attachments)) if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ["__proto__", "prototype", "constructor"].includes(id) || !info || !/^[a-f\d]{64}$/.test(info.sha256) || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size > 256 * 1024 * 1024 || typeof info.mime !== "string" || info.mime.length > 255 || typeof info.fileName !== "string" || info.fileName.length > 255 || /[\x00-\x1f/\\]/.test(info.fileName)) throw new DrawingWireError("invalid", "Invalid drawing original directory");
  for (const [id, version] of Object.entries(d.versions)) {
    if (!(/^[a-f\d]{32}$/i.test(id) || /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) || !version || typeof version.label !== "string" || version.label.length > 200 || typeof version.author !== "string" || !Number.isSafeInteger(version.revision) || version.revision < 0 || !Number.isFinite(version.createdAt)) throw new DrawingWireError("invalid", "Invalid drawing version directory");
    validateScene(version.scene);
  }
  if (new TextEncoder().encode(JSON.stringify(d)).length > 64 * 1024 * 1024) throw new DrawingWireError("invalid", "Drawing dependencies exceed the memory limit");
}
/** Stable comparison works across Rust's ordered JSON maps and JavaScript objects. */
export function drawingJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(drawingJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${drawingJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
