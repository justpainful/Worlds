import {
  validatePortableHistory,
  historyAttachmentIds,
  rewriteHistoryAttachments,
  historyVersionIds,
  historySourceScenes,
  portableScenesMatch,
  remapPortableHistory,
} from "./portableHistory";
import type { DrawingDocument } from "./model";
import { imageHeader } from "./imageHeaders";
import { validateScene, type DrawingScene } from "./model";
import { validateLibraryMetadata, type LibraryMetadata } from "./library";
import { decodePackageAsset } from "./packageDecode";
const HEADER = "WORLDSDRAW1\n";
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
interface PackageAsset {
  id: string;
  name: string;
  mime: string;
  sha256: string;
  data?: string;
  dataRef?: string;
  sceneAssetId?: string;
  versionId?: string;
  historyAttachmentId?: string;
}
interface PackageVersion {
  scene: DrawingScene;
  label: string;
}
export interface PackageExperiment {
  name: string;
  description: string;
  status: "draft" | "review" | "approved";
  sceneKey: string;
  baseKey: string;
  versionAliases: Record<string, string>;
}
export interface ImportedPackageExperiment {
  name: string;
  description: string;
  status: string;
  scene: DrawingScene;
  base: DrawingScene;
  versionAliases: Record<string, string>;
}
export interface DrawingPackage {
  format: "worldsdraw";
  version: 1 | 2 | 3;
  scene: DrawingScene;
  assets: PackageAsset[];
  versions?: Record<string, PackageVersion>;
  library?: LibraryMetadata;
  history?: DrawingDocument;
  experiments?: PackageExperiment[];
  preview?: { mime: "image/png"; width: number; height: number; sha256: string; data: string };
}
export async function digest(bytes: Uint8Array): Promise<string> {
  // Pass a view of existing ArrayBuffer-backed data. Copy only unusual shared
  // buffers, which Web Crypto cannot accept as BufferSource.
  const input =
    bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
  const hash = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 32768) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 32768)));
  return btoa(chunks.join(""));
}
async function collect(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  limit = MAX_PACKAGE_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(),
    parts: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("This project package exceeds the memory limit");
      parts.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.byteLength;
  }
  return result;
}

/** Encode large originals away from the editor and discard the worker on abort. */
async function encodeOriginal(
  bytes: Uint8Array<ArrayBuffer>,
  reload: () => Promise<Uint8Array<ArrayBuffer>>,
  signal?: AbortSignal,
): Promise<string> {
  const cancelled = () => new DOMException("Cancelled", "AbortError");
  const fallback = async () => {
    if (signal?.aborted) throw cancelled();
    const data = bytes.byteLength ? bytes : await reload();
    if (signal?.aborted) throw cancelled();
    return base64(data);
  };
  if (signal?.aborted) throw cancelled();
  if (typeof Worker === "undefined") return fallback();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./packageBase64.worker.ts", import.meta.url), { type: "module" });
    } catch {
      void fallback().then(resolve, reject);
      return;
    }
    const stop = () => {
      worker.terminate();
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      stop();
      reject(cancelled());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ data?: string; error?: string }>) => {
      stop();
      if (event.data.error) reject(new Error(event.data.error));
      else if (typeof event.data.data === "string") resolve(event.data.data);
      else reject(new Error("Could not encode the project original"));
    };
    worker.onerror = () => {
      stop();
      void fallback().then(resolve, reject);
    };
    try {
      worker.postMessage({ bytes }, [bytes.buffer]);
    } catch {
      stop();
      void fallback().then(resolve, reject);
    }
  });
}

/** Decode package JSON incrementally without first joining all inflated bytes
 * into a second contiguous binary buffer. The existing byte limit still applies. */
async function collectJson(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<string> {
  const reader = stream.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true }),
    parts: string[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PACKAGE_BYTES) throw new Error("This project package exceeds the memory limit");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Build JSON incrementally instead of duplicating every asset into one huge
 * JSON string before gzip. Asset data is generated by base64(), whose alphabet
 * needs no JSON escaping; other fields retain native JSON.stringify semantics. */
function packageJsonStream(payload: DrawingPackage, signal?: AbortSignal): ReadableStream<Uint8Array<ArrayBuffer>> {
  function* chunks(value: string): Generator<string> {
    for (let i = 0; i < value.length; ) {
      let end = Math.min(value.length, i + 65536);
      // Do not split a UTF-16 surrogate pair across TextEncoder calls.
      const last = value.charCodeAt(end - 1);
      if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
      yield value.slice(i, end);
      i = end;
    }
  }
  function* assetJson(asset: PackageAsset): Generator<string> {
    const { data, ...metadata } = asset;
    const prefix = JSON.stringify(metadata);
    if (data === undefined) {
      yield* chunks(prefix);
      return;
    }
    yield* chunks(prefix.slice(0, -1));
    yield ',"data":"';
    yield* chunks(data);
    yield '"}';
  }
  function* json(): Generator<string> {
    yield "{";
    let first = true;
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      if (!first) yield ",";
      first = false;
      yield `${JSON.stringify(key)}:`;
      if (key === "assets") {
        yield "[";
        for (const [index, asset] of payload.assets.entries()) {
          if (index) yield ",";
          yield* assetJson(asset);
        }
        yield "]";
      } else if (key === "versions" && payload.versions) {
        yield "{";
        let firstVersion = true;
        for (const [versionId, version] of Object.entries(payload.versions)) {
          if (!firstVersion) yield ",";
          firstVersion = false;
          yield `${JSON.stringify(versionId)}:`;
          yield* chunks(JSON.stringify(version));
        }
        yield "}";
      } else yield* chunks(JSON.stringify(value));
    }
    yield "}";
  }
  const iterator = json(),
    encoder = new TextEncoder();
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (signal?.aborted) {
        controller.error(new DOMException("Cancelled", "AbortError"));
        return;
      }
      try {
        const next = iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      iterator.return(undefined);
    },
  });
}

/** Keep gzip work away from the editor when transferable streams are available. */
async function compressPackage(payload: DrawingPackage, signal?: AbortSignal): Promise<Blob> {
  const cancelled = () => new DOMException("Cancelled", "AbortError");
  const fallback = async () => {
    if (signal?.aborted) throw cancelled();
    const bytes = await collect(packageJsonStream(payload, signal).pipeThrough(new CompressionStream("gzip")), signal);
    return new Blob([new Uint8Array(bytes)], { type: "application/gzip" });
  };
  if (signal?.aborted) throw cancelled();
  if (typeof Worker === "undefined") return fallback();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./packageCompress.worker.ts", import.meta.url), { type: "module" });
    } catch {
      void fallback().then(resolve, reject);
      return;
    }
    const stop = () => {
      worker.terminate();
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      stop();
      reject(cancelled());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string; unsupported?: boolean }>) => {
      stop();
      if (event.data.unsupported) void fallback().then(resolve, reject);
      else if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.blob) resolve(event.data.blob);
      else reject(new Error("Could not compress the project"));
    };
    worker.onerror = () => {
      stop();
      void fallback().then(resolve, reject);
    };
    const stream = packageJsonStream(payload, signal);
    try {
      worker.postMessage({ stream, limit: MAX_PACKAGE_BYTES }, [stream]);
    } catch {
      stop();
      void stream.cancel().catch(() => {});
      void fallback().then(resolve, reject);
    }
  });
}
/** The portable file contains originals; a sanitized image export never uses this path. */
export interface DrawingPackageOptions {
  includePreview?: boolean;
  includeHistory?: boolean;
  includeExperiments?: boolean;
  onExperimentSources?: (scenes: DrawingScene[], pageIds: string[]) => void;
  onHistorySources?: (scenes: DrawingScene[]) => void;
}
export async function createDrawingPackage(
  scene: DrawingScene,
  signal?: AbortSignal,
  pageId?: string,
  library?: LibraryMetadata,
  options: DrawingPackageOptions = {},
): Promise<Blob> {
  const { api, fileUrl } = await import("../lib/api");
  const checkCancelled = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  checkCancelled();
  validateScene(scene);
  const snapshot = structuredClone(scene),
    assets: PackageAsset[] = [],
    versions: Record<string, PackageVersion> = {};
  let total = 0;
  const pinned = (s: DrawingScene) => Object.values(s.steps).flatMap((step) => (step.pinnedVersionId ? [step.pinnedVersionId] : []));
  let history: DrawingDocument | undefined;
  if (options.includeHistory) {
    if (!pageId) throw new Error("Export history from its source drawing");
    const loaded = await api.drawingLoad(pageId);
    checkCancelled();
    history = structuredClone(loaded);
    validatePortableHistory(history);
    if (!portableScenesMatch(history.scene, scene, (id) => id))
      throw new Error("The drawing changed. Reopen export to include its history.");
    options.onHistorySources?.(historySourceScenes(history));
  }
  const experiments: PackageExperiment[] = [],
    experimentSources: DrawingScene[] = [],
    experimentPages: string[] = [];
  const pending: { id: string; page: string; key: string; prefix: string }[] = [
    ...pinned(snapshot),
    ...(history ? historyVersionIds(history) : []),
  ].map((id) => ({ id, page: pageId!, key: id, prefix: "" }));
  const addPins = (s: DrawingScene, owner: string, prefix: string) => {
    for (const step of Object.values(s.steps))
      if (step.pinnedVersionId) {
        const id = step.pinnedVersionId;
        step.pinnedVersionId = prefix + id;
        pending.push({ id, page: owner, key: prefix + id, prefix });
      }
  };
  if (options.includeExperiments) {
    if (!pageId) throw Error("Export experiments from their source drawing");
    const entries = await api.drawingExperiments(pageId);
    checkCancelled();
    if (entries.length > 24) throw Error("This package exceeds24 experiments");
    for (const [index, entry] of entries.entries()) {
      checkCancelled();
      const document = await api.drawingLoad(entry.page.id);
      checkCancelled();
      const info = document.experiment;
      if (!info || info.sourceId !== pageId) throw Error("The experiment source changed");
      const baseVersion = await api.drawingVersionScene(pageId, info.baseVersionId);
      checkCancelled();
      const base = structuredClone(baseVersion),
        branch = structuredClone(document.scene);
      validateScene(base);
      validateScene(branch);
      experimentSources.push(structuredClone(branch), structuredClone(base));
      experimentPages.push(entry.page.id);
      const prefix = `experiment:${index}:`,
        sceneKey = `experiment-scene:${index}`,
        baseKey = `experiment-base:${index}`,
        aliases: Record<string, string> = {};
      const direct = new Set(pinned(branch));
      for (const [old, target] of Object.entries(info.versionAliases ?? {}))
        if (direct.has(old)) {
          aliases[prefix + old] = target;
          pending.push({ id: target, page: pageId, key: target, prefix: "" });
        }
      addPins(branch, entry.page.id, prefix);
      addPins(base, pageId, "");
      versions[sceneKey] = { scene: branch, label: entry.page.title };
      versions[baseKey] = { scene: base, label: "Experiment comparison base" };
      experiments.push({
        name: entry.page.title,
        description: info.description,
        status: info.status,
        sceneKey,
        baseKey,
        versionAliases: aliases,
      });
    }
  }
  while (pending.length) {
    checkCancelled();
    const next = pending.pop()!;
    if (Object.hasOwn(versions, next.key)) continue;
    if (["__proto__", "constructor", "prototype"].includes(next.key) || Object.keys(versions).length >= 500)
      throw Error("Invalid or excessive presentation version dependencies");
    if (!next.page) throw Error("Export pinned presentations from their source drawing");
    const loaded = await api.drawingVersionScene(next.page, next.id);
    checkCancelled();
    const old = structuredClone(loaded);
    validateScene(old);
    if (experiments.length) experimentSources.push(structuredClone(old));
    addPins(old, next.page, next.prefix);
    versions[next.key] = { scene: old, label: "Presentation snapshot" };
  }
  if (experiments.length) {
    checkCancelled();
    options.onExperimentSources?.(experimentSources, experimentPages);
    const { checkDrawingExport } = await import("./files");
    await checkDrawingExport({
      pageId: pageId!,
      kind: "projects",
      sourcePageIds: experimentPages,
      scenes: [{ scene }, ...experimentSources.map((scene) => ({ scene }))],
    });
    checkCancelled();
  }
  const contents = new Set<string>(),
    attachmentCache = new Map<string, { size: number; sha256: string }>();
  const readOriginal = async (attachmentId: string, unavailable: string) => {
    const cached = attachmentCache.get(attachmentId);
    if (cached) return { ...cached, bytes: undefined as Uint8Array<ArrayBuffer> | undefined };
    const response = await fetch(fileUrl(attachmentId), { signal });
    if (!response.ok) throw new Error(unavailable);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_PACKAGE_BYTES / 2) throw new Error("The project originals are too large for this export");
    if (!response.body) throw new Error("Could not stream the project original");
    const bytes = await collect(response.body, signal, MAX_PACKAGE_BYTES / 2);
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const sha256 = await digest(bytes),
      size = bytes.length;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    attachmentCache.set(attachmentId, { size, sha256 });
    return { size, sha256, bytes };
  };
  const encodeAsset = (attachmentId: string, bytes: Uint8Array<ArrayBuffer>, sha256: string) =>
    encodeOriginal(
      bytes,
      async () => {
        const response = await fetch(fileUrl(attachmentId), { signal });
        if (!response.ok || !response.body) throw new Error("Could not read the project original");
        const reloaded = await collect(response.body, signal, MAX_PACKAGE_BYTES / 2);
        if ((await digest(reloaded)) !== sha256) throw new Error("The project original changed while exporting");
        return reloaded;
      },
      signal,
    );
  const packScene = async (s: DrawingScene, versionId?: string) => {
    for (const asset of Object.values(s.assets)) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const original = await readOriginal(asset.attachmentId, `Could not read ${asset.name}`);
      const { size, sha256 } = original,
        key = versionId ? `version:${versionId}:${asset.id}` : asset.id;
      const shared = contents.has(sha256);
      if (!shared) {
        total += size;
        if (total > MAX_PACKAGE_BYTES / 2) throw new Error("The project originals are too large for this export");
        contents.add(sha256);
      }
      assets.push({
        id: key,
        sceneAssetId: asset.id,
        versionId,
        name: asset.name,
        mime: asset.mime,
        sha256,
        ...(shared ? { dataRef: sha256 } : { data: await encodeAsset(asset.attachmentId, original.bytes!, sha256) }),
      });
      asset.attachmentId = `package:${key}`;
    }
  };
  await packScene(snapshot);
  for (const [versionId, version] of Object.entries(versions)) await packScene(version.scene, versionId);
  if (history) {
    const references = new Map<string, string>();
    for (const attachmentId of historyAttachmentIds(history)) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const original = await readOriginal(attachmentId, "A history original is unavailable");
      const shared = contents.has(original.sha256);
      if (!shared) {
        total += original.size;
        if (total > MAX_PACKAGE_BYTES / 2) throw new Error("The project originals are too large for this export");
        contents.add(original.sha256);
      }
      const metadata = [
        ...Object.values(history.seed.assets),
        ...Object.values(history.scene.assets),
        ...history.operations.flatMap((op) =>
          op.type === "edit"
            ? op.changes.flatMap((c) => (c.type === "put" && c.collection === "assets" ? [c.value as DrawingScene["assets"][string]] : []))
            : [],
        ),
      ].find((a) => a.attachmentId === attachmentId);
      assets.push({
        id: `history:${attachmentId}`,
        historyAttachmentId: attachmentId,
        name: metadata?.name ?? "history-original.bin",
        mime: metadata?.mime ?? "application/octet-stream",
        sha256: original.sha256,
        ...(shared ? { dataRef: original.sha256 } : { data: await encodeAsset(attachmentId, original.bytes!, original.sha256) }),
      });
      references.set(attachmentId, `package:history:${attachmentId}`);
    }
    history = rewriteHistoryAttachments(history, references);
    validatePortableHistory(history);
  }
  let preview: DrawingPackage["preview"];
  if (options.includePreview) {
    const { DrawingRenderer } = await import("./renderer"),
      renderer = new DrawingRenderer();
    const cancel = () => renderer.dispose();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const frame = scene.frames[scene.defaultFrameId],
        blob = await renderer.exportFrame(scene, frame, Math.min(1, 320 / frame.w, 180 / frame.h), true),
        bytes = new Uint8Array(await blob.arrayBuffer()),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      preview = {
        mime: "image/png",
        width: view.getUint32(16),
        height: view.getUint32(20),
        sha256: await digest(bytes),
        data: base64(bytes),
      };
    } finally {
      signal?.removeEventListener("abort", cancel);
      renderer.dispose();
    }
  }
  if (library) validateLibraryMetadata(library, snapshot);
  const payload: DrawingPackage = {
    format: "worldsdraw",
    version: experiments.length ? 3 : history ? 2 : 1,
    scene: snapshot,
    assets,
    versions,
    library,
    history,
    preview,
    ...(experiments.length ? { experiments } : {}),
  };
  const compressed = await compressPackage(payload, signal);
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  return new Blob([HEADER, compressed], { type: "application/x-worlds-drawing" });
}
export async function readDrawingPackage(blob: Blob, signal?: AbortSignal): Promise<DrawingPackage> {
  if (blob.size > MAX_PACKAGE_BYTES) throw new Error("The project package is too large");
  if ((await blob.slice(0, HEADER.length).text()) !== HEADER) throw new Error("This is not a Worlds drawing project");
  const stream = blob.slice(HEADER.length).stream().pipeThrough(new DecompressionStream("gzip"));
  const json = await collectJson(stream, signal);
  const value = JSON.parse(json) as DrawingPackage;
  if (value.format !== "worldsdraw" || ![1, 2, 3].includes(value.version) || !Array.isArray(value.assets))
    throw new Error("Unsupported drawing package version");
  validateScene(value.scene);
  if (value.library) validateLibraryMetadata(value.library, value.scene);
  if (value.history) {
    if (value.version < 2) throw new Error("Unsupported portable history version");
    validatePortableHistory(value.history);
  }
  if (value.preview) {
    const p = value.preview;
    if (
      p.mime !== "image/png" ||
      !Number.isInteger(p.width) ||
      !Number.isInteger(p.height) ||
      p.width < 1 ||
      p.height < 1 ||
      p.width > 320 ||
      p.height > 180 ||
      typeof p.data !== "string" ||
      p.data.length > 4 * 1024 * 1024 ||
      typeof p.sha256 !== "string"
    )
      throw new Error("Invalid project preview");
    const bytes = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0)),
      view = new DataView(bytes.buffer);
    imageHeader(bytes, 320, 4 * 1024 * 1024, false);
    if (
      bytes.length < 24 ||
      view.getUint32(0) !== 0x89504e47 ||
      view.getUint32(4) !== 0x0d0a1a0a ||
      view.getUint32(16) !== p.width ||
      view.getUint32(20) !== p.height ||
      (await digest(bytes)) !== p.sha256
    )
      throw new Error("Damaged project preview");
  }
  if (value.versions && (typeof value.versions !== "object" || Array.isArray(value.versions) || Object.keys(value.versions).length > 500))
    throw new Error("Invalid presentation versions");
  const scenes = new Map<string, DrawingScene>([["", value.scene]]);
  for (const [id, version] of Object.entries(value.versions ?? {})) {
    if (["__proto__", "constructor", "prototype"].includes(id) || !version || typeof version.label !== "string")
      throw new Error("Invalid presentation version");
    validateScene(version.scene);
    scenes.set(id, version.scene);
  }
  if (value.experiments !== undefined) {
    if (!Array.isArray(value.experiments) || value.experiments.length > 24) throw Error("Invalid portable experiments");
    const keys = new Set<string>();
    for (const e of value.experiments) {
      if (
        !e ||
        typeof e.name !== "string" ||
        !e.name.trim() ||
        e.name.length > 160 ||
        typeof e.description !== "string" ||
        e.description.length > 4000 ||
        !["draft", "review", "approved"].includes(e.status) ||
        typeof e.sceneKey !== "string" ||
        typeof e.baseKey !== "string" ||
        e.sceneKey === e.baseKey ||
        keys.has(e.sceneKey) ||
        keys.has(e.baseKey) ||
        !scenes.has(e.sceneKey) ||
        !scenes.has(e.baseKey) ||
        !e.versionAliases ||
        typeof e.versionAliases !== "object" ||
        Array.isArray(e.versionAliases) ||
        Object.keys(e.versionAliases).length > 500 ||
        Object.entries(e.versionAliases).some(([key, target]) => !scenes.has(key) || typeof target !== "string" || !scenes.has(target))
      )
        throw Error("Invalid portable experiment dependency");
      keys.add(e.sceneKey);
      keys.add(e.baseKey);
    }
  }
  for (const scene of scenes.values())
    for (const step of Object.values(scene.steps))
      if (step.pinnedVersionId && !scenes.has(step.pinnedVersionId))
        throw new Error("The package is missing a pinned presentation version");
  const seen = new Set<string>(),
    entries = new Set<string>(),
    data = new Map<string, string>(),
    verified = new Set<string>();
  for (const asset of value.assets) {
    if (
      !asset ||
      typeof asset.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      typeof asset.name !== "string" ||
      typeof asset.mime !== "string" ||
      (typeof asset.data === "string") === (typeof asset.dataRef === "string")
    )
      throw new Error("Invalid project asset directory");
    if (typeof asset.data === "string") {
      if (data.has(asset.sha256) && data.get(asset.sha256) !== asset.data) throw new Error(`The original ${asset.name} is damaged`);
      data.set(asset.sha256, asset.data);
    } else if (asset.dataRef !== asset.sha256) throw new Error("Invalid project asset reference");
  }
  const historyRefs = new Set(value.history ? historyAttachmentIds(value.history) : []);
  for (const asset of value.assets) {
    if (asset.historyAttachmentId !== undefined) {
      const key = asset.historyAttachmentId,
        entry = `history/${key}`,
        encoded = data.get(asset.sha256);
      if (
        typeof key !== "string" ||
        !key ||
        key.length > 160 ||
        asset.versionId !== undefined ||
        asset.sceneAssetId !== undefined ||
        !historyRefs.has(`package:history:${key}`) ||
        seen.has(asset.id) ||
        entries.has(entry) ||
        typeof encoded !== "string" ||
        encoded.length > MAX_PACKAGE_BYTES
      )
        throw new Error("Invalid history original directory");
      seen.add(asset.id);
      entries.add(entry);
      if (!verified.has(asset.sha256)) {
        if ((await digest(await decodePackageAsset(encoded, signal))) !== asset.sha256) throw new Error("Damaged history original");
        verified.add(asset.sha256);
      }
      continue;
    }
    const scene = scenes.get(asset?.versionId ?? ""),
      sceneAssetId = asset?.sceneAssetId ?? asset?.id,
      entry = `${asset?.versionId ?? ""}/${sceneAssetId}`,
      encoded = data.get(asset?.sha256);
    if (
      !asset ||
      typeof asset.id !== "string" ||
      seen.has(asset.id) ||
      entries.has(entry) ||
      !scene ||
      !Object.hasOwn(scene.assets, sceneAssetId) ||
      typeof encoded !== "string" ||
      encoded.length > MAX_PACKAGE_BYTES ||
      (asset.dataRef && asset.dataRef !== asset.sha256)
    )
      throw new Error("Invalid project asset directory");
    seen.add(asset.id);
    entries.add(entry);
    if (!verified.has(asset.sha256)) {
      const bytes = await decodePackageAsset(encoded, signal);
      if ((await digest(bytes)) !== asset.sha256) throw new Error(`The original ${asset.name} is damaged`);
      verified.add(asset.sha256);
    }
  }
  if (seen.size !== [...scenes.values()].reduce((sum, scene) => sum + Object.keys(scene.assets).length, 0) + historyRefs.size)
    throw new Error("The package is missing original assets");
  if (value.history) {
    for (const id of historyVersionIds(value.history)) if (!scenes.has(id)) throw new Error("The package is missing a history version");
    const hashes = new Map(
      value.assets.map((a) => [a.historyAttachmentId ? `package:history:${a.historyAttachmentId}` : `package:${a.id}`, a.sha256]),
    );
    if (!portableScenesMatch(value.history.scene, value.scene, (id) => hashes.get(id) ?? id))
      throw new Error("The history does not match the exported scene");
  }
  return value;
}
export async function importDrawingPackage(pageId: string, blob: Blob, signal?: AbortSignal): Promise<DrawingScene> {
  const { api } = await import("../lib/api");
  const pack = await readDrawingPackage(blob, signal),
    scene = structuredClone(pack.scene),
    versions = structuredClone(pack.versions ?? {});
  const needed = new Set<string>(),
    pending = Object.values(scene.steps).flatMap((step) => (step.pinnedVersionId ? [step.pinnedVersionId] : []));
  while (pending.length) {
    const id = pending.pop()!;
    if (needed.has(id)) continue;
    needed.add(id);
    pending.push(...Object.values(versions[id].scene.steps).flatMap((step) => (step.pinnedVersionId ? [step.pinnedVersionId] : [])));
  }
  for (const id of Object.keys(versions)) if (!needed.has(id)) delete versions[id];
  const versionIds = new Map(Object.keys(versions).map((id) => [id, crypto.randomUUID()]));
  const data = new Map<string, string>();
  for (const asset of pack.assets) if (typeof asset.data === "string") data.set(asset.sha256, asset.data);
  const imported = new Map<string, string>();
  for (const asset of pack.assets) {
    if (asset.historyAttachmentId !== undefined || (asset.versionId && !versions[asset.versionId])) continue;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    let attachmentId = imported.get(asset.sha256);
    if (!attachmentId) {
      const bytes = await decodePackageAsset(data.get(asset.sha256)!, signal);
      const attachment = await api.importBytes(pageId, asset.name, bytes);
      attachmentId = attachment.id;
      imported.set(asset.sha256, attachmentId);
    }
    const target = asset.versionId ? versions[asset.versionId].scene : scene;
    target.assets[asset.sceneAssetId ?? asset.id].attachmentId = attachmentId;
  }
  const remap = (s: DrawingScene) => {
    for (const step of Object.values(s.steps)) if (step.pinnedVersionId) step.pinnedVersionId = versionIds.get(step.pinnedVersionId)!;
  };
  delete scene.libraryPublication;
  remap(scene);
  for (const version of Object.values(versions)) {
    delete version.scene.libraryPublication;
    remap(version.scene);
  }
  for (const [oldId, version] of Object.entries(versions)) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    await api.drawingVersionImport(pageId, versionIds.get(oldId)!, version.label, version.scene);
  }
  return scene;
}
/** Editable experiment bundles always become fresh independent local drawings. */
export async function importDrawingBundlePackage(
  blob: Blob,
  name: string,
  signal?: AbortSignal,
  options: { history?: boolean; experiments?: boolean; onCommit?: () => void } = {},
) {
  const { api } = await import("../lib/api"),
    pack = await readDrawingPackage(blob, signal);
  if (options.history && !pack.history) throw Error("This package does not contain an operation history");
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const stage = await api.drawingPackageStage(name.trim() || "Imported drawing"),
    data = new Map<string, string>(),
    owned = new Map<string, string>(),
    references = new Map<string, string>(),
    scene = structuredClone(pack.scene),
    versions = structuredClone(pack.versions ?? {}),
    selected = options.experiments ? (pack.experiments ?? []) : [],
    decorators = new Set((pack.experiments ?? []).flatMap((e) => [e.sceneKey, e.baseKey]));
  let committed = false;
  try {
    const keep = new Set<string>(),
      pending = [
        ...Object.values(scene.steps).flatMap((step) => (step.pinnedVersionId ? [step.pinnedVersionId] : [])),
        ...(options.history && pack.history ? historyVersionIds(pack.history) : []),
        ...selected.flatMap((e) => [e.sceneKey, e.baseKey, ...Object.keys(e.versionAliases), ...Object.values(e.versionAliases)]),
      ];
    while (pending.length) {
      const id = pending.pop()!;
      if (keep.has(id)) continue;
      keep.add(id);
      pending.push(...Object.values(versions[id].scene.steps).flatMap((step) => (step.pinnedVersionId ? [step.pinnedVersionId] : [])));
    }
    for (const asset of pack.assets) if (asset.data) data.set(asset.sha256, asset.data);
    for (const asset of pack.assets) {
      if ((asset.historyAttachmentId !== undefined && !options.history) || (asset.versionId && !keep.has(asset.versionId))) continue;
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      let attachment = owned.get(asset.sha256);
      if (!attachment) {
        attachment = (await api.importBytes(stage.page.id, asset.name, await decodePackageAsset(data.get(asset.sha256)!, signal))).id;
        owned.set(asset.sha256, attachment);
      }
      if (asset.historyAttachmentId) references.set(`package:history:${asset.historyAttachmentId}`, attachment);
      else (asset.versionId ? versions[asset.versionId].scene : scene).assets[asset.sceneAssetId ?? asset.id].attachmentId = attachment;
    }
    const opIds = new Map((options.history ? (pack.history?.operations ?? []) : []).map((op) => [op.id, crypto.randomUUID()])),
      versionIds = new Map([...keep].map((id) => [id, opIds.get(id) ?? crypto.randomUUID()]));
    const remap = (s: DrawingScene) => {
      delete s.libraryPublication;
      for (const step of Object.values(s.steps))
        if (step.pinnedVersionId) {
          const id = versionIds.get(step.pinnedVersionId);
          if (!id) throw Error("Missing imported snapshot");
          step.pinnedVersionId = id;
        }
    };
    remap(scene);
    for (const id of keep) remap(versions[id].scene);
    for (const id of keep) {
      if (decorators.has(id)) continue;
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await api.drawingVersionImport(stage.page.id, versionIds.get(id)!, versions[id].label, versions[id].scene);
    }
    const document = options.history
      ? remapPortableHistory(rewriteHistoryAttachments(pack.history!, references), versionIds, opIds)
      : { revision: 0, seed: scene, scene, operations: [] };
    const experiments: ImportedPackageExperiment[] = selected.map((e) => ({
      name: e.name,
      description: e.description,
      status: e.status,
      scene: versions[e.sceneKey].scene,
      base: versions[e.baseKey].scene,
      versionAliases: Object.fromEntries(
        Object.entries(e.versionAliases).map(([key, value]) => [versionIds.get(key)!, versionIds.get(value)!]),
      ),
    }));
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    options.onCommit?.();
    const result = await api.drawingPackageInstall(stage.page.id, stage.token, document, experiments);
    committed = true;
    return result;
  } finally {
    if (!committed) await api.drawingPackageAbort(stage.page.id, stage.token).catch(() => false);
  }
}
/** Historical journals always become a fresh independent local drawing. */
export async function importDrawingHistoryPackage(blob: Blob, name: string, signal?: AbortSignal) {
  return (await importDrawingBundlePackage(blob, name, signal, { history: true })).page;
}
