import type { DrawingScene, Rect } from "./model";
export type DrawingExportKind = "images" | "projects" | "comments";
export type ExportLevel = "view" | "comment" | "edit" | "full";
export interface DrawingExportRules { images: ExportLevel; projects: ExportLevel; comments: ExportLevel }
export interface DrawingExportPolicy { revision: number; rules: DrawingExportRules }
export interface DrawingExportPolicyUpdate { requestId: string; expectedRevision: number; rules: DrawingExportRules }
export interface DrawingExportPolicyInfo { policy: DrawingExportPolicy; level: string; shared: boolean }
export interface DrawingExportScene { scene: DrawingScene; frameId?: string; annotations?: boolean; region?: Rect }
export interface DrawingExportContext { pageId: string; kind: DrawingExportKind; scenes: DrawingExportScene[]; archiveId?: string;sourcePageIds?:string[] }
export const DEFAULT_EXPORT_RULES: DrawingExportRules = { images: "view", projects: "view", comments: "view" };
const levels = ["none", "view", "comment", "edit", "full"];
export function validExportRules(value: unknown): value is DrawingExportRules { const p = value as DrawingExportRules; return !!p && typeof p === "object" && Object.keys(p).length === 3 && [p.images,p.projects,p.comments].every((v) => levels.slice(1).includes(v)); }
export function validExportPolicy(value: unknown): value is DrawingExportPolicy { const p = value as DrawingExportPolicy; return !!p && Number.isSafeInteger(p.revision) && p.revision >= 0 && validExportRules(p.rules); }
export function canDrawingExport(policy: DrawingExportPolicy, level: string, kind: DrawingExportKind) { return validExportPolicy(policy) && ["images","projects","comments"].includes(kind) && levels.indexOf(level) >= levels.indexOf(policy.rules[kind]); }
export function drawingExportEnvelope(bytes: Uint8Array, context: DrawingExportContext, token: string | null): Uint8Array {
  if (!bytes.length || bytes.length > 256*1024*1024) throw new Error("The export exceeds its size limit");
  const json = new TextEncoder().encode(JSON.stringify({context,token})); if(json.length>64*1024*1024)throw new Error("The export context exceeds its memory limit");
  const packet=new Uint8Array(4+json.length+bytes.length);new DataView(packet.buffer).setUint32(0,json.length,true);packet.set(json,4);packet.set(bytes,4+json.length);return packet;
}
/** Build the same authenticated IPC envelope without a second full image copy. */
export async function drawingExportBlobEnvelope(blob: Blob, context: DrawingExportContext, token: string | null, signal?: AbortSignal): Promise<Uint8Array> {
  if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error("The export exceeds its size limit");
  const json = new TextEncoder().encode(JSON.stringify({ context, token }));
  if (json.length > 64 * 1024 * 1024) throw new Error("The export context exceeds its memory limit");
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  let packet: Uint8Array<ArrayBuffer>;
  try { packet = new Uint8Array(4 + json.length + blob.size); }
  catch { throw new Error("Not enough memory to prepare this export. Close other work or export a smaller image."); }
  new DataView(packet.buffer).setUint32(0, json.length, true); packet.set(json, 4);
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const chunk = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    packet.set(chunk, 4 + json.length + offset);
  }
  return packet;
}
