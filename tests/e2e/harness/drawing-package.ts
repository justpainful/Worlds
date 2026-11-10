/**
 * E2E Test Harness: Drawing Scene Schema 1 & .worldsdraw ZIP Container
 *
 * Implements authoritative drawing data structures specified in PROJECT.md:
 * - JSON Schema: { schemaVersion: 1, scene: { id, layers, nodes, layerOrder }, history: [...] }
 * - Container: Standard ZIP archive containing manifest.json, scene.json, /assets/
 * - Brush dab format: { x: f32, y: f32, pressure: f32, tiltX: f32, tiltY: f32, timestamp: u64 }
 */

import * as zlib from "node:zlib";

export const SCHEMA_VERSION = 1;
export const MAX_STROKE_WORK_BUDGET = 2_000_000;
export const MAX_CANVAS_COORD = 16384;
export const MIN_CANVAS_COORD = -16384;

export interface Dab {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  timestamp: number;
}

export interface DrawingLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: "source-over" | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
  parentId: string | null;
}

export interface DrawingNode {
  id: string;
  type: "stroke" | "shape" | "image" | "text";
  layerId: string;
  dabs?: Dab[];
  brush?: {
    kind: string;
    size: number;
    color: string;
    opacity: number;
  };
  shape?: {
    kind: "rect" | "ellipse" | "line";
    x: number;
    y: number;
    w: number;
    h: number;
  };
  assetId?: string;
  text?: string;
  transform?: [number, number, number, number, number, number]; // 2x3 affine matrix
}

export interface DrawingSceneData {
  id: string;
  layers: DrawingLayer[];
  nodes: DrawingNode[];
  layerOrder: string[];
}

export interface DrawingSceneFile {
  schemaVersion: number;
  scene: DrawingSceneData;
  history: unknown[];
  metadata?: {
    title?: string;
    createdAt?: number;
    updatedAt?: number;
  };
}

export interface PackageManifest {
  format: "worldsdraw";
  version: 1;
  appVersion: string;
  createdAt: number;
  sceneFile: string;
  assets: Array<{
    id: string;
    path: string;
    mime: string;
    sha256?: string;
    size?: number;
  }>;
}

// Simple pure CRC32 implementation
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a standard PKZIP archive binary from in-memory file entries.
 */
export function buildZipArchive(
  files: Array<{ name: string; data: Uint8Array }>
): Uint8Array {
  const localHeaders: Uint8Array[] = [];
  const centralDirectoryHeaders: Uint8Array[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const filenameBytes = new TextEncoder().encode(file.name);
    const uncompressedData = file.data;
    const crc = calculateCrc32(uncompressedData);
    const compressedData = zlib.deflateRawSync(uncompressedData);

    const useCompressed = compressedData.length < uncompressedData.length;
    const compressionMethod = useCompressed ? 8 : 0;
    const storedData = useCompressed ? compressedData : uncompressedData;
    const compressedSize = storedData.length;
    const uncompressedSize = uncompressedData.length;

    // Local file header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const lv = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
    lv.setUint32(0, 0x04034b50, true); // Local header signature
    lv.setUint16(4, 20, true); // Version needed (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, compressionMethod, true);
    lv.setUint16(10, 0, true); // Last mod time
    lv.setUint16(12, 0, true); // Last mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressedSize, true);
    lv.setUint32(22, uncompressedSize, true);
    lv.setUint16(26, filenameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(filenameBytes, 30);

    // Central directory header (46 bytes + filename)
    const cdHeader = new Uint8Array(46 + filenameBytes.length);
    const cv = new DataView(cdHeader.buffer, cdHeader.byteOffset, cdHeader.byteLength);
    cv.setUint32(0, 0x02014b50, true); // CD header signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 filename flag
    cv.setUint16(10, compressionMethod, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressedSize, true);
    cv.setUint32(24, uncompressedSize, true);
    cv.setUint16(28, filenameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra field length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk number
    cv.setUint16(36, 0, true); // Internal attributes
    cv.setUint32(38, 0, true); // External attributes
    cv.setUint32(42, currentOffset, true); // Relative offset of local header
    cdHeader.set(filenameBytes, 46);

    localHeaders.push(localHeader, storedData);
    centralDirectoryHeaders.push(cdHeader);
    currentOffset += localHeader.length + storedData.length;
  }

  const centralDirSize = centralDirectoryHeaders.reduce((s, h) => s + h.length, 0);
  const cdOffset = currentOffset;

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true); // Disk number
  ev.setUint16(6, 0, true); // Start disk
  ev.setUint16(8, files.length, true); // Total entries this disk
  ev.setUint16(10, files.length, true); // Total entries
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true); // Comment length

  const totalLength = currentOffset + centralDirSize + eocd.length;
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of [...localHeaders, ...centralDirectoryHeaders, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/**
 * Parses a PKZIP archive and extracts all file entries.
 */
export function parseZipArchive(
  zipBytes: Uint8Array
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  if (zipBytes.length < 22) {
    throw new Error("Invalid ZIP archive: data too short for EOCD");
  }

  // Find EOCD (search from back)
  let eocdOffset = -1;
  const maxSearch = Math.min(zipBytes.length - 22, 65536);
  for (let i = zipBytes.length - 22; i >= zipBytes.length - 22 - maxSearch; i--) {
    if (
      zipBytes[i] === 0x50 &&
      zipBytes[i + 1] === 0x4b &&
      zipBytes[i + 2] === 0x05 &&
      zipBytes[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: EOCD signature not found");
  }

  const eocdView = new DataView(zipBytes.buffer, zipBytes.byteOffset + eocdOffset, 22);
  const totalEntries = eocdView.getUint16(10, true);
  const cdOffset = eocdView.getUint32(16, true);

  let cdPos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (cdPos + 46 > zipBytes.length) {
      throw new Error("Truncated Central Directory in ZIP archive");
    }
    const cdView = new DataView(zipBytes.buffer, zipBytes.byteOffset + cdPos, 46);
    const signature = cdView.getUint32(0, true);
    if (signature !== 0x02014b50) {
      throw new Error(`Corrupt CD signature at offset ${cdPos}`);
    }

    const compressionMethod = cdView.getUint16(10, true);
    const compressedSize = cdView.getUint32(20, true);
    const uncompressedSize = cdView.getUint32(24, true);
    const filenameLen = cdView.getUint16(28, true);
    const extraLen = cdView.getUint16(30, true);
    const commentLen = cdView.getUint16(32, true);
    const localHeaderOffset = cdView.getUint32(42, true);

    const filenameBytes = zipBytes.subarray(cdPos + 46, cdPos + 46 + filenameLen);
    const filename = new TextDecoder().decode(filenameBytes);

    // Read local header
    const localView = new DataView(zipBytes.buffer, zipBytes.byteOffset + localHeaderOffset, 30);
    if (localView.getUint32(0, true) !== 0x04034b50) {
      throw new Error(`Corrupt local file header at offset ${localHeaderOffset}`);
    }
    const localFilenameLen = localView.getUint16(26, true);
    const localExtraLen = localView.getUint16(28, true);
    const dataOffset = localHeaderOffset + 30 + localFilenameLen + localExtraLen;

    const rawData = zipBytes.subarray(dataOffset, dataOffset + compressedSize);
    let extractedData: Uint8Array;
    if (compressionMethod === 0) {
      extractedData = rawData;
    } else if (compressionMethod === 8) {
      extractedData = zlib.inflateRawSync(rawData);
    } else {
      throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }

    if (extractedData.length !== uncompressedSize) {
      throw new Error(
        `Size mismatch for ${filename}: expected ${uncompressedSize}, got ${extractedData.length}`
      );
    }

    result.set(filename, extractedData);
    cdPos += 46 + filenameLen + extraLen + commentLen;
  }

  return result;
}

/**
 * Validates a DrawingScene against Schema 1 specifications.
 */
export function validateDrawingScene(sceneData: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!sceneData || typeof sceneData !== "object") {
    return { valid: false, errors: ["Scene data must be an object"] };
  }

  const s = sceneData as DrawingSceneFile;
  if (s.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`Expected schemaVersion ${SCHEMA_VERSION}, got ${s.schemaVersion}`);
  }

  if (!s.scene || typeof s.scene !== "object") {
    errors.push("Missing required scene object");
    return { valid: false, errors };
  }

  if (!s.scene.id || typeof s.scene.id !== "string") {
    errors.push("Scene requires valid string id");
  }

  if (!Array.isArray(s.scene.layers)) {
    errors.push("Scene layers must be an array");
  } else {
    for (const layer of s.scene.layers) {
      if (!layer.id || typeof layer.name !== "string") {
        errors.push(`Invalid layer definition: ${JSON.stringify(layer)}`);
      }
      if (typeof layer.opacity !== "number" || layer.opacity < 0 || layer.opacity > 1) {
        errors.push(`Layer opacity must be between 0 and 1, got ${layer.opacity}`);
      }
      const allowedBlends = new Set(["source-over", "normal", "multiply", "screen", "overlay", "darken", "lighten"]);
      if (layer.blend && !allowedBlends.has(layer.blend)) {
        errors.push(`Invalid layer blend mode: ${layer.blend}`);
      }
    }
  }

  if (!Array.isArray(s.scene.nodes)) {
    errors.push("Scene nodes must be an array");
  } else {
    for (const node of s.scene.nodes) {
      if (!node.id || !node.type) {
        errors.push(`Node missing id or type: ${JSON.stringify(node)}`);
      }
      if (node.dabs) {
        for (const dab of node.dabs) {
          if (
            typeof dab.x !== "number" ||
            !Number.isFinite(dab.x) ||
            typeof dab.y !== "number" ||
            !Number.isFinite(dab.y)
          ) {
            errors.push(`Invalid dab coordinates: (${dab.x}, ${dab.y})`);
          }
          if (typeof dab.pressure !== "number" || !Number.isFinite(dab.pressure) || dab.pressure < 0 || dab.pressure > 1) {
            errors.push(`Dab pressure out of range [0, 1]: ${dab.pressure}`);
          }
          if (
            typeof dab.tiltX !== "number" ||
            !Number.isFinite(dab.tiltX) ||
            dab.tiltX < -90 ||
            dab.tiltX > 90 ||
            typeof dab.tiltY !== "number" ||
            !Number.isFinite(dab.tiltY) ||
            dab.tiltY < -90 ||
            dab.tiltY > 90
          ) {
            errors.push(`Dab tilt out of range [-90, 90]: (${dab.tiltX}, ${dab.tiltY})`);
          }
        }
      }
    }
  }

  if (!Array.isArray(s.scene.layerOrder)) {
    errors.push("Scene layerOrder must be an array");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Computes stroke pigment work budget to prevent resource exhaustion
 */
export function computeStrokeWork(dabs: Dab[], brushSize: number): number {
  const safeSize = Math.max(1, brushSize);
  if (dabs.length <= 1) return safeSize * safeSize;
  let work = 0;
  for (let i = 1; i < dabs.length; i++) {
    const dx = dabs[i].x - dabs[i - 1].x;
    const dy = dabs[i].y - dabs[i - 1].y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const pressure = Math.max(0.1, (dabs[i].pressure + dabs[i - 1].pressure) / 2);
    work += dist * safeSize * pressure + safeSize * 0.5;
  }
  return work;
}
