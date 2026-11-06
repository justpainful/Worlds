import {validateDrawingDocument} from "../drawing/canonical";
import {mockHistoryCandidate} from "../drawing/undo";
/**
 * Development-only stand-in for the Tauri backend, so the interface can be
 * reviewed in a plain browser (http://localhost:1420/?mock). It implements
 * the IPC surface with in-memory sample data. Never active in Worlds itself:
 * it only installs when there is no real Tauri runtime and the URL asks for it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { appendOperation, edit, newDrawing, sceneChanges } from "../drawing/operations";
import type { DrawingDocument } from "../drawing/model";
import type { LibraryPublication } from "../drawing/library";
import { DEFAULT_EXPORT_RULES, canDrawingExport, type DrawingExportPolicy } from "../drawing/exportPolicy";
const exportPolicies:Record<string,DrawingExportPolicy>={};
const drawings: Record<string, DrawingDocument> = {};
const drawingLibrary: Record<string, LibraryPublication[]> = {};
const drawingVersions: Record<string, { id: string; label: string; revision: number; author: string; createdAt: number; scene: DrawingDocument["scene"] }[]> = {};
const now = Date.now();
const id = () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

function md(markdownLines: string[]) {
  // tiny markdown → nodes (enough for review data)
  return markdownLines.map((l) => {
    const bid = id();
    if (l.startsWith("## ")) return { type: "heading", attrs: { level: 2, bid }, content: [{ type: "text", text: l.slice(3) }] };
    if (l.startsWith("# ")) return { type: "heading", attrs: { level: 1, bid }, content: [{ type: "text", text: l.slice(2) }] };
    if (l.startsWith("- [ ] ") || l.startsWith("- [x] "))
      return { type: "taskList", attrs: { bid }, content: [{ type: "taskItem", attrs: { checked: l[3] === "x" }, content: [{ type: "paragraph", content: [{ type: "text", text: l.slice(6) }] }] }] };
    if (l.startsWith("- ")) return { type: "bulletList", attrs: { bid }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: l.slice(2) }] }] }] };
    if (l.startsWith("> ")) return { type: "callout", attrs: { tone: "note", bid }, content: [{ type: "paragraph", content: [{ type: "text", text: l.slice(2) }] }] };
    return { type: "paragraph", attrs: { bid }, content: l ? [{ type: "text", text: l }] : undefined };
  });
}

const profile: any = {
  id: "me",
  blocks: new URLSearchParams(location.search).has("frames")
    ? [
        { id: "f1", type: "frame", size: "6x1", style: "minimal", photos: ["mock-ref-5"], shape: "classic", fit: "fill", radius: 26, shadow: true, text: "Weekend build", textPos: "bottom" },
        { id: "f2", type: "frame", size: "3x1", style: "minimal", photos: ["mock-avatar"], shape: "upright", fit: "whole", radius: 26, shadow: true },
        { id: "f3", type: "frame", size: "3x1", style: "minimal", photos: ["mock-ref-6", "mock-banner"], shape: "circle", fit: "fill", radius: 26, shadow: true, interval: 4 },
        { id: "b1", type: "info", size: "12x1", style: "solid", label: "Now", title: "Playing tonight", subtitle: "Co-op session" },
      ]
    : [],
  bannerFocus: null,
  avatarCrop: null,
  displayName: "Alex Rivera",
  handle: "alex",
  avatar: "mock-avatar",
  banner: new URLSearchParams(location.search).has("white") ? "mock-white" : "mock-banner",
  bio: "Building calm tools for thinking. أحب التصميم الهادئ والتفاصيل.",
  status: "Exploring Game Development",
  accent: "#d2a46e",
  theme: "dark",
  language: "auto",
  textDirection: "auto",
  location: "Riyadh",
  links: [{ label: "Discord", url: "https://discord.com" }, { label: "GitHub", url: "https://github.com" }],
  createdAt: now - 40 * 86_400_000,
  updatedAt: now,
};

const pages: Record<string, any> = {};
const blocks: Record<string, any[]> = {};
const metadata: Record<string, any> = {};

function addPage(title: string, icon: string | null, lines: string[], extra: any = {}) {
  const pid = id();
  pages[pid] = {
    id: pid, title, icon, cover: null, parentId: null, sortKey: Object.keys(pages).length, ownerId: "me", kind: "page", templateCategory: null,
    pinned: false, pinOrder: null, favorite: false, archived: false, deletedAt: null, preview: lines.filter((l) => !l.startsWith("#")).join(" · ").slice(0, 200),
    createdAt: now - 86_400_000 * 3, updatedAt: now - 3_600_000, openedAt: now - 600_000, ...extra,
  };
  blocks[pid] = md(lines);
  return pid;
}
const p1 = addPage("اهلًا هذه تجربة!", "😎", ["# أهلا", "تجربة تجريبتين ثلاث تجارب، هذا نص عادي مع نص عريض.", "- [ ] مهمة أولى", "- [x] مهمة منتهية", "> ملاحظة: حدثنا Nova8 إلى v2.4.1."], { pinned: true, pinOrder: 1 });
addPage("Release Notes", "🚀", ["Version v1.0.0 · Date 2026-10-03", "## Highlights", "- Native window frame", "## Fixes", "- Faster Discord reconnects"], { cover: new URLSearchParams(location.search).has("white") ? "mock-white" : "mock-ref-5" });
addPage("Discord Announcement", "📣", ["# الاجتماع الإداري", "الوقت 8:00 PM", "## المواضيع", "- المتجر", "- السيرفر"]);
addPage("Meeting Notes", "🪑", ["## Attendees", "- Alex", "## Decisions", "- Ship the glass redesign"], { pinned: true, pinOrder: 2 });

const chats: any[] = [
  { id: "c1", title: "خطة المتجر", pageId: null, createdAt: now - 86_400_000, updatedAt: now - 86_400_000, messageCount: 2 },
  { id: "c2", title: "Release notes draft", pageId: null, createdAt: now - 3_600_000, updatedAt: now - 3_600_000, messageCount: 2 },
];
const chatMessages: Record<string, any[]> = {
  c1: [
    { id: "m1", role: "user", content: "نبي نرتب أسعار المتجر الجديدة", steps: [], opId: null, meta: {}, createdAt: now - 86_400_000 },
    { id: "m2", role: "assistant", content: "رتبت الأسعار في صفحة **المتجر**:\n\n- الباقة الأساسية: 49 ريال\n- الباقة المميزة: 99 ريال\n\nتبي أضيفها لإعلان ديسكورد؟", steps: [{ tool: "pages_read", ok: true }, { tool: "blocks_update", ok: true }], opId: "op1", meta: { changeCount: 2, pages: [{ id: p1, title: "اهلًا هذه تجربة!" }] }, createdAt: now - 86_400_000 + 5000 },
  ],
  c2: [
    { id: "m3", role: "user", content: "Draft the v2.4.1 release notes", steps: [], opId: null, meta: {}, createdAt: now - 3_600_000 },
    { id: "m4", role: "assistant", content: "Done. I added **Highlights** and **Fixes** to @[Release Notes](page:x).", steps: [{ tool: "pages_search", ok: true }], opId: "op2", meta: { changeCount: 3 }, createdAt: now - 3_600_000 + 4000 },
  ],
};

const settings: Record<string, unknown> = { "advanced.developer": true, "advanced.perfOverlay": new URLSearchParams(location.search).has("perf"), "appearance.glassTone": new URLSearchParams(location.search).get("tone") ?? "auto" };
const callbacks = new Map<number, (v: any) => void>();
const listeners = new Map<string, number[]>();
let cbSeq = 1;

function emit(event: string, payload: unknown) {
  for (const h of listeners.get(event) ?? []) callbacks.get(h)?.({ event, id: h, payload });
}

/** Generated stand-in pictures; a machine-local `private/reference/` folder can replace them. */
const art = (a: string, b: string, c: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1150" cy="300" r="260" fill="${c}" opacity="0.55"/><circle cx="380" cy="700" r="320" fill="${c}" opacity="0.3"/></svg>`,
  );
const LOCAL = import.meta.glob("/private/reference/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const local = (file: string, fallback: string) => LOCAL[`/private/reference/${file}`] ?? fallback;

const ASSET: Record<string, string> = {
  "mock-banner": local("ref-7.webp", art("#1d2b64", "#f8cdda", "#7f7fd5")),
  "mock-avatar": local("claude-icon.png", art("#d97757", "#f2c1a8", "#ffffff")),
  "mock-ref-5": local("ref-5.jpg", art("#f7971e", "#ffd200", "#ffffff")),
  "mock-ref-6": local("ref-6.jpg", art("#134e5e", "#71b280", "#d4fc79")),
  // A near-white picture, for testing controls over bright covers and banners.
  "mock-white": "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="700"><defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef1f6"/></linearGradient></defs><rect width="1600" height="700" fill="url(#g)"/><circle cx="1200" cy="420" r="160" fill="#dfe6f0"/></svg>'),
};

async function handle(cmd: string, a: any = {}): Promise<any> {
  if (cmd.startsWith("plugin:event|")) {
    if (cmd === "plugin:event|listen") {
      const arr = listeners.get(a.event) ?? [];
      arr.push(a.handler);
      listeners.set(a.event, arr);
      return a.handler;
    }
    return null;
  }
  if (cmd.startsWith("plugin:window|")) {
    if (cmd.endsWith("is_maximized") || cmd.endsWith("is_minimized")) return false;
    if (cmd.endsWith("outer_position")) return { x: 0, y: 0 };
    if (cmd.endsWith("outer_size")) return { width: 1380, height: 880 };
    if (cmd.endsWith("available_monitors")) return [];
    return null;
  }
  if (cmd.startsWith("plugin:")) return cmd.endsWith("is_enabled") ? false : null;
  const page = (pid: string) => pages[pid] && { ...pages[pid], metadata: metadata[pid] ?? {}, instructions: [], blocks: (blocks[pid] ?? []).map((c, i) => ({ id: c.attrs.bid, pageId: pid, type: c.type, order: i, content: c, properties: {}, direction: "auto", createdAt: now, updatedAt: now })), backlinks: [], attachments: [], breadcrumbs: [] };
  switch (cmd) {
    case "bootstrap": return { profile, pages: Object.values(pages), settings, dataDir: "C:\\mock" };
    case "launch_info": return { hidden: false };
    case "pages_list": return Object.values(pages);
    case "page_get": return page(a.id) ?? null;
    case "drawing_load": return drawings[a.pageId] ??= newDrawing();
    case "drawing_export_policy_cached": return {policy:exportPolicies[a.pageId]??{revision:0,rules:{...DEFAULT_EXPORT_RULES}},level:"full",shared:false};
    case "drawing_export_policy": {let policy=exportPolicies[a.pageId]??{revision:0,rules:{...DEFAULT_EXPORT_RULES}};if(a.update){if(a.update.expectedRevision!==policy.revision)throw new Error("The export policy changed");policy=exportPolicies[a.pageId]={revision:policy.revision+1,rules:{...a.update.rules}};}return {policy,level:"full",shared:false};}
    case "drawing_export_requirements": return false;
    case "drawing_export_check": if(!canDrawingExport(exportPolicies[a.context.pageId]??{revision:0,rules:{...DEFAULT_EXPORT_RULES}},"full",a.context.kind))throw new Error("Export is unavailable");return null;
    case "drawing_apply": return drawings[a.pageId] = appendOperation(drawings[a.pageId] ??= newDrawing(), a.operation, profile.id);
    case "drawing_package_stage":{const pid=addPage(a.name,'pi:paintbrush',[],{kind:'drawing'}),token=id();metadata[pid]={sync:{shared:false},packageStage:{token,owner:profile.id}};pages[pid].archived=true;drawings[pid]=newDrawing();return{page:pages[pid],token};}
    case "drawing_package_abort":{if(metadata[a.pageId]?.packageStage?.token!==a.token)return false;const d=drawings[a.pageId];if(d&&(d.revision||Object.keys(d.scene.nodes).length))throw Error('Import stage changed');delete drawings[a.pageId];delete drawingVersions[a.pageId];delete metadata[a.pageId];delete pages[a.pageId];return true;}
    case "drawing_package_install":{if(metadata[a.pageId]?.packageStage?.token!==a.token||(drawings[a.pageId]?.revision??0)!==0)throw Error('Import stage changed');validateDrawingDocument(a.document);const prepared=a.experiments.map((e:any)=>{validateDrawingDocument({revision:0,seed:e.scene,scene:e.scene,operations:[]});return structuredClone(e);});drawings[a.pageId]=structuredClone(a.document);const imported=[];
      for(const e of prepared){const base=id(),pid=addPage(e.name,'pi:paintbrush',[],{kind:'drawing'}),versions=new Map((drawingVersions[a.pageId]??[]).map(v=>[v.id,id()]));(drawingVersions[a.pageId]??=[]).push({id:base,revision:0,label:'Imported comparison base',author:profile.id,createdAt:Date.now(),scene:e.base});const scene=structuredClone(e.scene),remap=(s:any)=>{for(const step of Object.values(s.steps)as any[])if(step.pinnedVersionId)step.pinnedVersionId=versions.get(step.pinnedVersionId);};remap(scene);drawingVersions[pid]=(drawingVersions[a.pageId]??[]).filter(v=>versions.has(v.id)).map(v=>{const copy=structuredClone(v);copy.id=versions.get(v.id)!;remap(copy.scene);return copy;});const aliases=Object.fromEntries(Object.entries(e.versionAliases as Record<string,string>).map(([key,value])=>[versions.get(key)!,value])),info={sourceId:a.pageId,baseVersionId:base,author:profile.id,createdAt:Date.now(),description:e.description,status:e.status,versionAliases:aliases};metadata[pid]={sync:{shared:false},experiment:info};drawings[pid]={revision:0,seed:scene,scene,operations:[],experiment:info};imported.push(pages[pid]);}
      pages[a.pageId].archived=false;delete metadata[a.pageId].packageStage;return{page:pages[a.pageId],experiments:imported};}
    case "drawing_history_import": {
      const before=drawings[a.pageId]??=newDrawing();if(before.revision||before.operations.length||Object.keys(before.scene.nodes).length||Object.keys(before.scene.assets).length||(pages[a.pageId]?.metadata as any)?.sync?.shared)throw new Error("History can only be imported into a new local drawing with no edits");
      validateDrawingDocument(a.document);drawings[a.pageId]=structuredClone(a.document);return drawings[a.pageId];
    }
    case "drawing_history_toggle": {
      if(a.actor!==profile.id)throw new Error("Undo belongs to another signed-in account");const doc=drawings[a.pageId]??=newDrawing(),old=doc.operations.find(op=>op.id===a.requestId);
      if(old){if(old.type!=="toggle"||old.actor!==a.actor||old.base!==a.expectedRevision||old.enabled!==a.redo)throw new Error("Undo request identifier was reused");return{document:doc,operationId:old.id,window:mockHistoryCandidate(doc,profile.id,a.redo).window};}
      if(doc.revision!==a.expectedRevision)throw new Error("history-stale: The drawing changed before Undo. Review the current drawing and try again.");const choice=mockHistoryCandidate(doc,profile.id,a.redo);if(!choice.target)return{document:doc,operationId:null,window:choice.window};
      const operation={id:a.requestId,actor:profile.id,base:doc.revision,at:Date.now(),label:a.redo?"Redo":"Undo",type:"toggle" as const,target:choice.target.id,enabled:a.redo};const document=drawings[a.pageId]=appendOperation(doc,operation);return{document,operationId:operation.id,window:choice.window};
    }
    case "drawing_versions": return drawingVersions[a.pageId] ?? [];
    case "drawing_version_save": { const doc = drawings[a.pageId] ??= newDrawing(), version = { id: id(), label: a.label, revision: doc.revision, author: profile.id, createdAt: Date.now(), scene: structuredClone(doc.scene) }; (drawingVersions[a.pageId] ??= []).push(version); return version; }
    case "drawing_version_scene": return drawingVersions[a.pageId]?.find((v) => v.id === a.versionId)?.scene;
    case "drawing_version_restore": {
      const before = drawings[a.pageId] ??= newDrawing(), prior = before.operations.find((op) => op.id === a.restoreId);
      if (prior) return { operationId: a.restoreId, backupId: a.restoreId, document: before };
      if (before.revision !== a.expectedRevision) throw new Error("The drawing changed after this preview");
      const target = drawingVersions[a.pageId]?.find((v) => v.id === a.versionId)?.scene;
      if (!target) throw new Error("Saved version is unavailable");
      if (JSON.stringify(before.scene) === JSON.stringify(target)) throw new Error("This version already matches the current drawing");
      const operation = { ...edit(profile.id, before.revision, a.label, sceneChanges(before.scene, target)), id: a.restoreId };
      const next = appendOperation(before, operation);
      (drawingVersions[a.pageId] ??= []).push({ id: a.restoreId, label: a.backupLabel, revision: before.revision, author: profile.id, createdAt: Date.now(), scene: structuredClone(before.scene) });
      drawings[a.pageId] = next; return { operationId: a.restoreId, backupId: a.restoreId, document: next };
    }
    case "drawing_version_import": { const version = { id: a.versionId, revision: 0, label: a.label, author: profile.id, createdAt: Date.now(), scene: structuredClone(a.scene) }; (drawingVersions[a.pageId] ??= []).push(version); return { id: a.versionId }; }
    case "drawing_materialize_assets": return structuredClone(a.scene);
    case "drawing_experiment_create": {
      const source = drawings[a.pageId] ??= newDrawing(), version = { id: id(), label: `Experiment base: ${a.name}`, revision: source.revision, author: profile.id, createdAt: Date.now(), scene: structuredClone(source.scene) };
      (drawingVersions[a.pageId] ??= []).push(version);
      const pid = addPage(a.name, "pi:paintbrush", [], { kind: "drawing", parentId: a.pageId });
      const info = { sourceId: a.pageId, baseVersionId: version.id, author: profile.id, createdAt: Date.now(), description: a.description, status: "draft" as const };
      metadata[pid] = { experiment: info }; drawings[pid] = { revision: 0, seed: structuredClone(source.scene), scene: structuredClone(source.scene), operations: [], experiment: info };
      return pages[pid];
    }
    case "drawing_experiments": return Object.values(pages).filter((page) => metadata[page.id]?.experiment?.sourceId === a.pageId && !page.deletedAt).map((page) => ({ page, experiment: metadata[page.id].experiment }));
    case "drawing_library_list": return Object.values(drawingLibrary).flatMap((versions) => { const item = versions.at(-1)!.item; return pages[item.page.id]?.deletedAt ? [] : [{ ...item, page: pages[item.page.id] }]; });
    case "drawing_library_read": { const versions = drawingLibrary[a.itemId], chosen = versions?.find((v) => v.version === (a.version ?? versions.at(-1)!.version)); if (!chosen || pages[a.itemId]?.deletedAt) throw new Error("Library item unavailable"); return structuredClone({ ...chosen, item: { ...versions.at(-1)!.item, page: pages[a.itemId] } }); }
    case "drawing_library_instantiate": {
      const publication = drawingLibrary[a.itemId]?.find((v) => v.version === a.version);
      if (!publication || publication.item.kind !== "template" || pages[a.itemId]?.deletedAt) throw new Error("Choose an available drawing template");
      const pid = addPage(publication.item.page.title, "pi:paintbrush", [], { kind: "drawing" }), scene = structuredClone(publication.scene);
      drawings[pid] = { revision: 0, seed: structuredClone(scene), scene, operations: [] };
      return pages[pid];
    }
    case "drawing_library_publish": {
      const input = a.input, old = input.itemId ? drawingLibrary[input.itemId]?.at(-1) : undefined;
      if (input.itemId && (!old || old.version !== input.expectedVersion)) throw new Error("Library changed. Refresh before publishing another version");
      const pid = old?.item.page.id ?? addPage(input.name, "pi:paintbrush", [], { kind: "drawing" }), version = (old?.version ?? 0) + 1, createdAt = Date.now();
      pages[pid].title = input.name;
      const publication: LibraryPublication = { item: { page: pages[pid], kind: input.kind, tags: input.tags, sourceId: input.sourceId, owner: profile.id, scope: input.scope, workspaceId: input.scope === "workspace" ? "mock-team" : null, version, canEdit: true, canDelete: true, versions: [{ version, createdAt, author: profile.id }, ...(old?.item.versions ?? [])] }, version, scene: structuredClone(input.scene), payload: structuredClone(input.payload) };
      (drawingLibrary[pid] ??= []).push(publication);
      drawings[pid] ??= { revision: 0, seed: structuredClone(input.scene), scene: structuredClone(input.scene), operations: [] }; return structuredClone(publication);
    }
    case "drawing_library_remove": { if (pages[a.itemId]) pages[a.itemId].deletedAt = Date.now(); return; }
    case "drawing_reference_search": return Object.values(pages).filter((p) => !p.deletedAt && !p.archived && p.title.toLowerCase().includes(a.query.toLowerCase()) && (!a.editable || ["page", "document", "presentation"].includes(p.kind))).slice(0, 100);
    case "sync_page_mode":return {shared:!!metadata[a.pageId]?.sync?.shared,workspaceId:null,flagged:false};
    case "drawing_reference_read": {
      if(a.offline&&metadata[a.sourceId]?.sync?.shared)return{state:"offline",checkedAt:Date.now()};
      const page = pages[a.sourceId]; if (!page || page.deletedAt) return { state: "unavailable", checkedAt: Date.now() };
      let tasksDone = 0, tasksTotal = 0; const count = (node: any) => { if (node.type === "taskItem") { tasksTotal++; if (node.attrs?.checked) tasksDone++; } (node.content ?? []).forEach(count); }; (blocks[a.sourceId] ?? []).forEach(count);
      return { state: "ready", sourceId: a.sourceId, title: page.title, kind: page.kind, excerpt: page.preview, updatedAt: page.updatedAt, checkedAt: Date.now(), tasksDone, tasksTotal };
    }
    case "drawing_reference_task": {
      const pid = addPage(a.title, "pi:checklist", [], { parentId: a.pageId });
      blocks[pid] = [{ type: "taskList", attrs: { bid: id() }, content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: a.title }] }] }] }, { type: "drawingEmbed", attrs: { bid: id(), pageId: a.pageId, frameId: a.frameId, camera: a.camera, versionId: null } }]; return pages[pid];
    }
    case "drawing_embed_insert": { (blocks[a.targetId] ??= []).push({ type: "drawingEmbed", attrs: { bid: id(), pageId: a.pageId, frameId: a.frameId, camera: a.camera, versionId: a.versionId } }); return; }
    case "page_create": {
      const pid = addPage(a.page.title ?? "", a.page.icon ?? null, [], { kind: a.page.kind ?? "page", parentId: a.page.parentId ?? null });
      metadata[pid] = a.page.metadata ?? {};
      return pages[pid];
    }
    case "page_delete": {const page=pages[a.id];if(page){page.deletedAt=Date.now();page.updatedAt=Date.now();}return;}
    case "page_update": {
      const { metadata: md, ...rest } = a.patch;
      if (md) metadata[a.id] = md;
      Object.assign(pages[a.id], rest, { updatedAt: Date.now() });
      return pages[a.id];
    }
    case "page_meta_set": {
      metadata[a.id] = { ...(metadata[a.id] ?? {}), [a.key]: a.value };
      pages[a.id].updatedAt = Date.now();
      return pages[a.id];
    }
    case "attachment_import": {
      const name: string = a.path.split(/[\\/]/).pop();
      const ext = name.split(".").pop()!.toLowerCase();
      const mime = ext === "gif" ? "image/gif" : ["png", "jpg", "jpeg", "webp"].includes(ext) ? "image/png" : ["mp4", "webm"].includes(ext) ? "video/mp4" : ext === "pdf" ? "application/pdf" : "application/octet-stream";
      const aid = id();
      ASSET[aid] = mime.startsWith("image/") ? ASSET["mock-ref-5"] : "";
      return { id: aid, pageId: a.pageId, kind: mime.startsWith("image/") ? (ext === "gif" ? "gif" : "image") : mime.startsWith("video/") ? "video" : "file", fileName: name, mime, size: 123456, width: 800, height: 600, createdAt: Date.now() };
    }
    case "attachment_import_raw": {
      const aid = id(), bytes = new Uint8Array(a.bytes), blob = new Blob([bytes]);
      ASSET[aid] = URL.createObjectURL(blob);
      return { id: aid, pageId: a.pageId, kind: "image", fileName: a.name, mime: "image/png", size: bytes.byteLength, width: null, height: null, createdAt: Date.now() };
    }
    case "blocks_save": {
      // Same rule as the real backend: a save based on an older sync is refused.
      if (a.base != null && pages[a.pageId] && pages[a.pageId].updatedAt > a.base) throw "conflict: the page changed since it was loaded";
      const at = Math.max(Date.now(), (pages[a.pageId]?.updatedAt ?? 0) + 1);
      blocks[a.pageId] = a.blocks.map((b: any) => b.content);
      if (pages[a.pageId]) pages[a.pageId].updatedAt = at;
      return { added: 0, changed: 0, removed: 0, remapped: [], updatedAt: at };
    }
    case "search": return Object.values(pages).filter((p: any) => p.title.includes(a.query)).map((p: any) => ({ pageId: p.id, title: p.title, icon: p.icon, kind: p.kind, snippet: p.preview, parentTitle: null, updatedAt: p.updatedAt }));
    case "history_list": return [{ id: 1, pageId: p1, pageTitle: pages[p1].title, opId: null, actor: "user", kind: "edited", summary: "Edited · 3 changed", blockId: null, before: null, after: null, meta: {}, createdAt: now - 600_000 }];
    case "versions_list": return [];
    case "profile_get": return profile;
    case "profile_update": Object.assign(profile, a.patch); return { ...profile };
    case "profile_stats": return {
      pages: Object.keys(pages).length, chats: chats.length, automations: 2, streak: 6, edits7d: 23, words: 4180,
      activeDays: Array.from({ length: 28 }, (_, i) => ({ date: new Date(Date.now() - (27 - i) * 864e5).toISOString().slice(0, 10), count: [0, 1, 3, 0, 2, 5, 1][i % 7] })),
    };
    case "media_recent": return [
      { id: "mock-banner", pageId: null, kind: "image", fileName: "banner.webp", mime: "image/webp", size: 1, relPath: "", width: 1600, height: 900, createdAt: Date.now() },
      { id: "mock-ref-5", pageId: null, kind: "image", fileName: "ref-5.jpg", mime: "image/jpeg", size: 1, relPath: "", width: 1600, height: 900, createdAt: Date.now() },
      { id: "mock-ref-6", pageId: null, kind: "image", fileName: "ref-6.jpg", mime: "image/jpeg", size: 1, relPath: "", width: 1600, height: 900, createdAt: Date.now() },
    ];
    case "settings_set": settings[a.key] = a.value; return null;
    case "session_save": case "client_log": case "window_set_transparency": return null;
    case "data_dir": return "C:\\mock";
    case "ai_status": return { available: true, version: "2.1.288 (Claude Code)", mcpRegistered: true };
    case "ai_token_status": return { saved: false };
    case "ai_token_open_setup": return null;
    case "ai_token_save": if (!String(a?.token ?? "").startsWith("sk-ant-")) throw "That does not look like a Claude token. Copy the whole line that starts with sk-ant-."; return null;
    case "ai_token_clear": return null;
    case "ai_chats": return [...chats].sort((x, y) => y.updatedAt - x.updatedAt);
    case "ai_chat": return { id: a.id, messages: chatMessages[a.id] ?? [] };
    case "ai_chat_delete": return null;
    case "ai_chat_rename": return null;
    case "ai_run": {
      const runId = id();
      const chatId = a.request.chatId ?? "c-new";
      if (!chatMessages[chatId]) {
        chatMessages[chatId] = [];
        chats.unshift({ id: chatId, title: a.request.prompt.slice(0, 40), pageId: null, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 });
      }
      chatMessages[chatId].push({ id: id(), role: "user", content: a.request.prompt, steps: [], opId: null, meta: {}, createdAt: Date.now() });
      if (new URLSearchParams(location.search).has("fastai")) {
        // The whole run finishes before ai_run returns (tests the early-event path).
        chatMessages[chatId].push({ id: id(), role: "assistant", content: "Done already.", steps: [{ tool: "pages_read", ok: true }], opId: runId, meta: { changeCount: 0 }, createdAt: Date.now() });
        emit("worlds://ai", { runId, kind: "tool", tool: "pages_read" });
        emit("worlds://ai", { runId, kind: "tool_result", error: false });
        emit("worlds://ai", { runId, kind: "done", chatId, text: "ok" });
        return { runId, chatId };
      }
      setTimeout(() => emit("worlds://ai", { runId, kind: "tool", tool: "pages_read" }), 400);
      setTimeout(() => emit("worlds://ai", { runId, kind: "tool_result", error: false }), 900);
      setTimeout(() => emit("worlds://ai", { runId, kind: "text", text: "Here is a short summary of the page." }), 1300);
      setTimeout(() => {
        chatMessages[chatId].push({ id: id(), role: "assistant", content: "Here is a short summary of the page:\n\n- It welcomes you\n- It lists **two tasks**\n- It mentions version 2.4.1", steps: [{ tool: "pages_read", ok: true }], opId: runId, meta: { changeCount: 0 }, createdAt: Date.now() });
        emit("worlds://ai", { runId, kind: "done", chatId, text: "ok" });
      }, 2600);
      return { runId, chatId };
    }
    case "automations_list": return [];
    case "automation_runs": return [];
    case "pending_actions": return [];
    case "discord_destinations": return { guilds: [], users: [] };
    case "backups_list": return { backups: [{ file: "worlds-1-daily.db", createdAt: now - 3_600_000, reason: "daily", size: 2_400_000 }], pendingRestore: null, note: null, folder: "C:/Worlds/backups" };
    case "backup_now": return { file: "worlds-2-manual.db", createdAt: Date.now(), reason: "manual", size: 2_400_000 };
    case "backup_restore": case "backup_cancel_restore": return null;
    case "discord_status": return { state: "connected", bot: { tag: "Worlds Bot#0001" }, config: {} };
    case "preview_prepare": return { kind: "none" };
    case "attachment_import_raw": {
      // Keep the bytes as a blob URL so the editor can show what was pasted.
      const name: string = a.name;
      const kind = /\.gif$/i.test(name) ? "gif" : /\.(png|jpe?g|webp)$/i.test(name) ? "image" : /\.(mp4|webm|mov)$/i.test(name) ? "video" : "file";
      const mime = kind === "gif" ? "image/gif" : kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "application/octet-stream";
      const aid = id();
      ASSET[aid] = URL.createObjectURL(new Blob([new Uint8Array(a.bytes)], { type: mime }));
      return { id: aid, pageId: a.pageId, kind, fileName: name, mime, size: a.bytes.length, width: 64, height: 64, createdAt: Date.now() };
    }
    case "attachment_get": return null;
    case "drawing_sync_pending_pages": return [];
    default:
      console.warn("[mock] unhandled", cmd, a);
      return null;
  }
}

export function mockFileUrl(attachmentId: string): string {
  return ASSET[attachmentId] ?? "";
}

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window) && new URLSearchParams(location.search).has("mock")) {
  (window as any).__WORLDS_MOCK__ = true;
  (window as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    invoke: (cmd: string, args: any, opts?: { headers?: Record<string, string> }) =>
      handle(
        cmd,
        cmd === "attachment_import_raw"
          ? { bytes: args, name: decodeURIComponent(opts?.headers?.["x-worlds-name"] ?? "file"), pageId: decodeURIComponent(opts?.headers?.["x-worlds-page"] ?? "") || null }
          : args,
      ),
    transformCallback: (cb: (v: any) => void) => {
      const n = cbSeq++;
      callbacks.set(n, cb);
      return n;
    },
    unregisterCallback: (n: number) => callbacks.delete(n),
    convertFileSrc: (p: string) => p,
  };
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}

/**
 * Scripted steps for headless renders: `?mock&act=click:Release Notes|key:ctrl+k`.
 * Each step runs 900ms after the previous one. Dev only.
 */
if (import.meta.env.DEV && (window as any).__WORLDS_MOCK__) {
  const act = new URLSearchParams(location.search).get("act");
  if (act) {
    const steps = act.split("|");
    const run = (i: number) => {
      if (i >= steps.length) return;
      const [kind, ...rest] = steps[i].split(":");
      const arg = rest.join(":");
      if (kind === "click") {
        const all = [...document.querySelectorAll<HTMLElement>("button, a, [role=button], [role=tab], [role=menuitem], .tree-row, .sb-row, div, span")];
        const hit = all.find((e) => e.getAttribute("aria-label") === arg) ?? all.find((e) => e.children.length === 0 && e.textContent?.trim() === arg);
        (hit?.closest<HTMLElement>("button, a, [role=button], [role=tab], [role=menuitem], [data-page-id]") ?? hit)?.click();
      } else if (kind === "key") {
        const parts = arg.toLowerCase().split("+");
        const key = parts[parts.length - 1];
        const init = { key: key.length === 1 ? key : key[0].toUpperCase() + key.slice(1), ctrlKey: parts.includes("ctrl"), shiftKey: parts.includes("shift"), altKey: parts.includes("alt"), bubbles: true };
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", init));
      } else if (kind === "context") {
        const t = document.querySelector<HTMLElement>(arg) ?? document.body;
        const r = t.getBoundingClientRect();
        t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 40 }));
      }
      setTimeout(() => run(i + 1), 900);
    };
    setTimeout(() => run(0), 1800);
  }
}
