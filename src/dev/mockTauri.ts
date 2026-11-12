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
import { DEFAULT_BRUSH, newLayer, newNode } from "../drawing/model";
import { newSlide, slideToBlock } from "../resources/deck/model";
import { foldArabic } from "../i18n/locale";
import type { DrawingDocument } from "../drawing/model";
import type { LibraryPublication } from "../drawing/library";
import { DEFAULT_EXPORT_RULES, canDrawingExport, type DrawingExportPolicy } from "../drawing/exportPolicy";
import providersJson from "../ai/providers.json";
/** The public web demo build (`pnpm build:demo`): the mock is the whole backend there. */
export const WEB_DEMO = import.meta.env.VITE_WEB_DEMO === "1";
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

/** Provider presets for the browser preview; `secret` stands in for the credential store and never leaves this file. */
const mockProviders: { id: string; name: string; api: string; kind: "runner" | "cloud" | "local"; baseUrl: string; defaultBaseUrl: string; editableBaseUrl: boolean; key: "none" | "required" | "optional"; note?: string; secret?: string }[] =
  ((providersJson as { providers: { id: string; name: string; api: string; kind: "runner" | "cloud" | "local"; baseUrl?: string; editableBaseUrl?: boolean; key: "none" | "required" | "optional"; note?: string }[] }).providers).map((p) => ({
    id: p.id, name: p.name, api: p.api, kind: p.kind, baseUrl: p.baseUrl ?? "", defaultBaseUrl: p.baseUrl ?? "", editableBaseUrl: !!p.editableBaseUrl, key: p.key, note: p.note,
  }));

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
  accent: "#2e92ff",
  theme: "dark",
  language: new URLSearchParams(location.search).get("lang") ?? "auto",
  textDirection: "auto",
  location: "Riyadh",
  links: [{ label: "Discord", url: "https://discord.com" }, { label: "GitHub", url: "https://github.com" }],
  createdAt: now - 40 * 86_400_000,
  updatedAt: now,
};

// The public web demo in Arabic shows an Arabic profile, so nothing on screen stays in English.
if (WEB_DEMO && profile.language === "ar") {
  Object.assign(profile, { displayName: "ريم", handle: "reem", bio: "طالبة ثانوي، أنظم دراستي ومشاريعي في Worlds.", status: "أراجع لاختبار الأحياء", location: "الرياض" });
}

const pages: Record<string, any> = {};
const blocks: Record<string, any[]> = {};
const metadata: Record<string, any> = {};

/** A card preview like the backend's: the page's text without its headings, 200 characters at most. */
function previewOf(nodes: any[]): string {
  const text = (n: any): string => (typeof n?.text === "string" ? n.text : (n?.content ?? []).map(text).join(n?.type === "paragraph" ? "" : " "));
  const body = nodes.filter((n) => n?.type !== "heading").map(text).filter((t) => t.trim());
  return (body.length ? body : nodes.map(text)).join(" · ").replace(/\s+/g, " ").trim().slice(0, 200);
}

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
const p1 = WEB_DEMO ? "" : addPage("اهلًا هذه تجربة!", "😎", ["# أهلا", "تجربة تجريبتين ثلاث تجارب، هذا نص عادي مع نص عريض.", "- [ ] مهمة أولى", "- [x] مهمة منتهية", "> ملاحظة: حدثنا Nova8 إلى v2.4.1."], { pinned: true, pinOrder: 1 });
if (!WEB_DEMO) addPage("Release Notes", "🚀", ["Version v1.0.0 · Date 2026-10-03", "## Highlights", "- Native window frame", "## Fixes", "- Faster Discord reconnects"], { cover: new URLSearchParams(location.search).has("white") ? "mock-white" : "mock-ref-5" });
if (!WEB_DEMO) addPage("Discord Announcement", "📣", ["# الاجتماع الإداري", "الوقت 8:00 PM", "## المواضيع", "- المتجر", "- السيرفر"]);
if (!WEB_DEMO) addPage("Meeting Notes", "🪑", ["## Attendees", "- Alex", "## Decisions", "- Ship the glass redesign"], { pinned: true, pinOrder: 2 });

const chats: any[] = WEB_DEMO ? [] : [
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

// This is an explicitly synthetic gallery for screenshots. It never reads the
// owner's database or reference images and only exists in a development mock.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock") && new URLSearchParams(location.search).has("demo")) {
  profile.displayName = "Maya Studio";
  profile.handle = "maya";
  profile.bio = "A sample workspace for notes, creative work and projects.";
  const requestedLanguage = new URLSearchParams(location.search).get("lang");
  if (requestedLanguage === "ar" || requestedLanguage === "en") profile.language = requestedLanguage;
  chats[0] = { ...chats[0], title: "Demo: planning a launch", messageCount: 4 };
  chatMessages.c1 = [
    { id: "demo-user-1", role: "user", content: "Help me organize the launch plan into clear milestones.", steps: [], opId: null, meta: {}, createdAt: now - 120000 },
    { id: "demo-ai-1", role: "assistant", content: "I can organize the work into three milestones:\n\n1. **Prepare** the content and visual assets.\n2. **Review** the details with the team.\n3. **Launch** and collect feedback.\n\nWhich milestone would you like to expand first?", steps: [], opId: null, meta: {}, createdAt: now - 110000 },
    { id: "demo-user-2", role: "user", content: "Start with the preparation checklist.", steps: [], opId: null, meta: {}, createdAt: now - 60000 },
    { id: "demo-ai-2", role: "assistant", content: "Here is a practical starting checklist:\n\n- Confirm the audience and launch date.\n- Gather the final artwork and copy.\n- Prepare the announcement and review it with the team.\n\nThis is a demonstration conversation.", steps: [], opId: null, meta: {}, createdAt: now - 50000 },
  ];
  const project = addPage("Demo · Creative launch", "pi:folder", [], { kind: "project", favorite: true });
  metadata[project] = { project: { status: "active", start: "2026-11-01", due: "2026-12-01", description: "A fictional workspace bringing the launch brief, presentation, visual ideas, and notes together.", links: [] } };
  const doc = addPage("Demo · Launch brief", "pi:text", ["# Launch brief", "A shared outline for a thoughtful product launch.", "## The idea", "Bring the story, the artwork, and the practical work together in one place.", "## Priorities", "- Define the audience and the purpose", "- Prepare the visual direction", "- Review the announcement with the team", "> This document uses demonstration content."], { kind: "document", parentId: project });
  metadata[doc] = { doc: { size: "A4", orientation: "portrait", margins: { top: 25, right: 22, bottom: 25, left: 22 }, font: "", fontSize: 12, lineHeight: 1.5 } };
  const aiPage = addPage("Demo · مساحة مساعد الصفحة", "pi:page", ["# مساحة العمل مع Claude", "هذه صفحة توضيحية ببيانات تجريبية، تعرض كيف تساعدك الأوامر داخل الصفحة على تنظيم أفكارك.", "## موجز الإطلاق", "نجمع الفكرة والمواد وخطوات التنفيذ في مكان واحد لمراجعتها مع الفريق."], { parentId: project, favorite: true });
  blocks[aiPage].push({ type: "prompt", attrs: { bid: id(), label: "Prompt" }, content: [{ type: "paragraph", content: [{ type: "text", text: "اقرأ موجز الإطلاق أعلاه، ثم اقترح قائمة مهام مرتبة حسب الأولوية." }] }] });
  blocks[aiPage].push(...md(["## أسئلة للمراجعة", "- من الجمهور المستهدف؟", "- ما المواد التي تحتاج موافقة قبل الإطلاق؟"]));
  chats.unshift(
    { id: "demo-workspace-tools", title: "Demo: تنظيم صفحة المشروع", pageId: doc, createdAt: now - 300000, updatedAt: now - 30000, messageCount: 4 },
    { id: "demo-files", title: "Demo: تحليل ملف", pageId: null, createdAt: now - 600000, updatedAt: now - 90000, messageCount: 2 },
    { id: "demo-undone", title: "Demo: التراجع عن تعديل", pageId: doc, createdAt: now - 900000, updatedAt: now - 150000, messageCount: 2 },
  );
  chatMessages["demo-workspace-tools"] = [
    { id: "demo-tools-user-1", role: "user", content: "اقرأ موجز الإطلاق ورتّب أولويات العمل في قائمة واضحة.", steps: [], opId: null, meta: { pageId: doc }, createdAt: now - 260000 },
    { id: "demo-tools-ai-1", role: "assistant", content: "قرأت **موجز الإطلاق** وجهّزت قائمة عملية للمراجعة:\n\n1. تحديد الجمهور والهدف.\n2. تجهيز المواد والهوية البصرية.\n3. مراجعة نص الإعلان مع الفريق.\n\nهذه محادثة توضيحية ببيانات تجريبية.", steps: [{ tool: "pages_search", ok: true }, { tool: "pages_read", ok: true }, { tool: "blocks_update", ok: true }], opId: "demo-op-edit", meta: { changeCount: 3, pages: [{ id: doc, title: "Demo · Launch brief" }] }, createdAt: now - 240000 },
    { id: "demo-tools-user-2", role: "user", content: "وش الخطوة التالية المقترحة؟", steps: [], opId: null, meta: { pageId: doc }, createdAt: now - 80000 },
    { id: "demo-tools-ai-2", role: "assistant", content: "ابدأ بتحديد موعد مراجعة الموجز، ثم اجمع الملاحظات في صفحة واحدة قبل اعتماد خطة الإطلاق.", steps: [{ tool: "pages_read", ok: true }], opId: null, meta: {}, createdAt: now - 60000 },
  ];
  chatMessages["demo-files"] = [
    { id: "demo-file-user", role: "user", content: "لخص الملف المرفق واقترح ثلاث نقاط عملية.", steps: [], opId: null, meta: { attachments: [{ id: "demo-brief-pdf", name: "Demo launch brief.pdf", mime: "application/pdf", kind: "file", size: 24576 }] }, createdAt: now - 580000 },
    { id: "demo-file-ai", role: "assistant", content: "**ملخص تجريبي**\n\nيركز الموجز على تحديد الجمهور، وتجهيز المواد، ومراجعة المحتوى قبل الإطلاق.\n\n- اتفقوا على الهدف والموعد.\n- جهزوا قائمة المواد المطلوبة.\n- راجعوا النسخة النهائية مع الفريق.\n\nالمرفق والنتيجة للعرض فقط.", steps: [{ tool: "attachments_read_metadata", ok: true }, { tool: "pages_search", ok: true }], opId: null, meta: {}, createdAt: now - 560000 },
  ];
  chatMessages["demo-undone"] = [
    { id: "demo-undo-user", role: "user", content: "رتب العناوين في موجز الإطلاق.", steps: [], opId: null, meta: { pageId: doc }, createdAt: now - 880000 },
    { id: "demo-undo-ai", role: "assistant", content: "رتبت العناوين في الموجز. هذه حالة توضيحية لعملية تم التراجع عنها.", steps: [{ tool: "pages_read", ok: true }, { tool: "blocks_update", ok: true }], opId: "demo-op-undo", meta: { changeCount: 2, pages: [{ id: doc, title: "Demo · Launch brief" }], undone: true }, createdAt: now - 860000 },
  ];
  const deck = addPage("Demo · Launch presentation", "pi:presentation", [], { kind: "presentation", parentId: project });
  metadata[deck] = { deck: { aspect: "16:9", theme: "dark" } };
  const cover = newSlide("title"); cover.elements[0].text = "A thoughtful launch"; cover.elements[1].text = "Ideas, preparation and next steps";
  const detail = newSlide("title-body"); detail.elements[0].text = "The plan"; detail.elements[1].text = "Prepare the story\nCreate the visual direction\nShare and refine together";
  blocks[deck] = [slideToBlock(cover).content, slideToBlock(detail).content];
  const drawing = addPage("Demo · Drawing studio", "pi:paintbrush", [], { kind: "drawing", parentId: project });
  const document = newDrawing(), scene = document.scene, frame = scene.frames[scene.defaultFrameId];
  Object.assign(frame, { name: "Ideas canvas", w: 1120, h: 720, background: "#f8f6ef" });
  const base = scene.layers[scene.layerOrder[0]]; base.name = "Sketch";
  const layer = newLayer("Notes and color"); scene.layers[layer.id] = layer; scene.layerOrder.push(layer.id);
  const add = (node: ReturnType<typeof newNode>) => { scene.nodes[node.id] = node; scene.nodeOrder.push(node.id); return node; };
  const title = add(newNode("text", layer.id, frame.id, { x: 65, y: 45, w: 950, h: 82 })); title.text = "Ideas take shape"; title.textStyle = { ...title.textStyle, size: 48, weight: 700, color: "#263d37" };
  const subtitle = add(newNode("text", layer.id, frame.id, { x: 67, y: 130, w: 900, h: 45 })); subtitle.text = "A sample drawing made with Worlds"; subtitle.textStyle = { ...subtitle.textStyle, size: 24, color: "#6b756b" };
  for (const [i, shape] of (["ellipse", "right-triangle", "roundrect"] as const).entries()) { const node = add(newNode("shape", base.id, frame.id, { x: 90 + i * 325, y: 230, w: 230, h: 215 })); node.shape = shape; node.paint = { ...node.paint, fill: ["#e2af68", "#83ad94", "#ce7866"][i], stroke: "#314b42", strokeWidth: 3 }; }
  for (const [i, kind] of (["ink", "oil", "crayon", "watercolor", "highlighter"] as const).entries()) { const node = add(newNode("stroke", layer.id, frame.id, { x: 90, y: 500 + i * 31, w: 465, h: 35 })); node.name = `Sample ${kind}`; node.brush = { ...DEFAULT_BRUSH, kind, color: ["#315d49", "#ce6f53", "#e4ad45", "#6689a5", "#e9c74a"][i], size: i === 4 ? 22 : 11, opacity: i === 4 ? 0.4 : 1 }; node.samples = Array.from({ length: 54 }, (_, j) => ({ x: j * 8, y: 15 + Math.sin(j / 7) * 8, pressure: .75, tiltX: 0, tiltY: 0, time: j * 5 })); node.seed = i + 1; }
  document.seed = structuredClone(scene); drawings[drawing] = document;
  const gallery = addPage("Demo · Visual library", "pi:image", [], { kind: "gallery", parentId: project });
  metadata[gallery] = { gallery: { view: "grid" } };
  blocks[gallery] = ["mock-ref-5", "mock-ref-6", "mock-banner"].map((attachmentId, i) => ({ type: "galleryItem", attrs: { bid: `gallery-demo-${i}`, attachmentId, name: `Color study ${i + 1}.png`, mime: "image/png", size: 1024, kind: "image", caption: ["Warm light", "Natural tones", "Evening study"][i] } }));
  const sampleFile = addPage("Demo · Color study.svg", "pi:image", [], { kind: "file", parentId: project });
  metadata[sampleFile] = { file: { attachmentId: "mock-ref-5", name: "Color study.svg", mime: "image/svg+xml", size: 1024, kind: "image" } };
  const sampleStream = addPage("Demo · Sample video", "pi:video", [], { kind: "stream", parentId: project });
  metadata[sampleStream] = { stream: { url: "/src/dev/demo-stream.mp4", format: "progressive" } };
}

const settings: Record<string, unknown> = WEB_DEMO ? { "account.onboarded": true } : { "advanced.developer": true, "advanced.perfOverlay": new URLSearchParams(location.search).has("perf"), "appearance.glassTone": new URLSearchParams(location.search).get("tone") ?? "auto", ...(new URLSearchParams(location.search).has("demo") && !new URLSearchParams(location.search).has("onboarding") ? { "account.onboarded": true } : {}) };
try { if (localStorage.getItem("worlds.demo.tourSeen")) settings["tour.seen"] = true; } catch { /* private window */ }
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
const local = (file: string, fallback: string) => new URLSearchParams(location.search).has("demo") ? fallback : LOCAL[`/private/reference/${file}`] ?? fallback;

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
    case "capture_screen_for_drawing": {
      if (!new URLSearchParams(location.search).has("demo")) throw new Error("Screen capture is unavailable in the browser mock");
      const canvas = document.createElement("canvas"); canvas.width = 1920; canvas.height = 1080;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Demo canvas unavailable");
      ctx.fillStyle = "#f4f2e9"; ctx.fillRect(0, 0, 1920, 1080);
      ctx.fillStyle = "#1f302b"; ctx.fillRect(0, 0, 1920, 86);
      ctx.fillStyle = "#ffffff"; ctx.font = "500 27px sans-serif"; ctx.fillText("MATHEMATICS LESSON   ·   DEMO", 72, 55);
      ctx.fillStyle = "#243a33"; ctx.font = "600 52px sans-serif"; ctx.fillText("A right triangle", 180, 240);
      ctx.font = "32px sans-serif"; ctx.fillStyle = "#5d6c63"; ctx.fillText("Find the missing length before continuing the lesson.", 180, 300);
      ctx.beginPath(); ctx.moveTo(500, 710); ctx.lineTo(500, 400); ctx.lineTo(1020, 710); ctx.closePath(); ctx.strokeStyle = "#416c59"; ctx.lineWidth = 8; ctx.stroke();
      ctx.font = "600 45px sans-serif"; ctx.fillStyle = "#243a33"; ctx.fillText("3", 432, 570); ctx.fillText("4", 750, 785); ctx.fillText("?", 785, 515);
      ctx.fillStyle = "#d1a069"; ctx.fillRect(0, 1036, 1920, 8);
      return { dataUrl: canvas.toDataURL("image/png"), width: 1920, height: 1080, wasFullscreen: false };
    }
    case "end_screen_drawing": return null;
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
      const t = Date.now();
      const pid = addPage(a.page.title ?? "", a.page.icon ?? null, [], { kind: a.page.kind ?? "page", parentId: a.page.parentId ?? null, createdAt: t, updatedAt: t, openedAt: t });
      if (Array.isArray(a.page.blocks)) blocks[pid] = a.page.blocks.map((b: any) => ({ ...b, attrs: { ...(b.attrs ?? {}), bid: b.attrs?.bid ?? id() } }));
      else if (typeof a.page.markdown === "string") blocks[pid] = md(a.page.markdown.split("\n"));
      // Like the backend, only pages and documents have a text preview.
      if (["page", "document", "lesson"].includes(pages[pid].kind)) pages[pid].preview = previewOf(blocks[pid] ?? []);
      metadata[pid] = a.page.metadata ?? {};
      if (metadata[pid][pages[pid].kind] !== undefined) pages[pid].data = metadata[pid][pages[pid].kind];
      return pages[pid];
    }
    case "page_delete": {const page=pages[a.id];if(page){const t=Date.now();const walk=(pid:string)=>{if(pages[pid]&&!pages[pid].deletedAt){pages[pid].deletedAt=t;}for(const c of Object.values(pages))if(c.parentId===pid)walk(c.id);};walk(a.id);page.updatedAt=t;}return;}
    case "page_restore": {const t=pages[a.id]?.deletedAt;if(t)for(const p of Object.values(pages))if(p.deletedAt===t)p.deletedAt=null;return;}
    case "page_purge": {delete pages[a.id];delete metadata[a.id];return;}
    case "page_move": {Object.assign(pages[a.id],{parentId:a.parentId??null,updatedAt:Date.now()});return pages[a.id];}
    case "page_update": {
      const { metadata: md, ...rest } = a.patch;
      if (md) metadata[a.id] = md;
      Object.assign(pages[a.id], rest, { updatedAt: Date.now() });
      return pages[a.id];
    }
    case "page_meta_set": {
      metadata[a.id] = { ...(metadata[a.id] ?? {}), [a.key]: a.value };
      if (a.key === pages[a.id].kind) pages[a.id].data = a.value;
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
      if (pages[a.pageId]) {
        pages[a.pageId].updatedAt = at;
        pages[a.pageId].preview = previewOf(blocks[a.pageId]);
      }
      return { added: 0, changed: 0, removed: 0, remapped: [], updatedAt: at };
    }
    case "search": {
      // Like the app's search: title and text, with Arabic spellings folded.
      const q = foldArabic(String(a.query ?? "").toLowerCase().trim());
      return Object.values(pages).filter((p: any) => !p.deletedAt && q && foldArabic(`${p.title} ${p.preview ?? ""}`.toLowerCase()).includes(q)).map((p: any) => ({ pageId: p.id, title: p.title, icon: p.icon, kind: p.kind, snippet: p.preview, parentTitle: null, updatedAt: p.updatedAt }));
    }
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
    case "settings_set":
      settings[a.key] = a.value;
      // A visitor who closed the tour should not see it again on every reload.
      if (a.key === "tour.seen") try { localStorage.setItem("worlds.demo.tourSeen", "1"); } catch { /* private window */ }
      return null;
    case "session_save": case "client_log": case "window_set_transparency": return null;
    case "data_dir": return "C:\\mock";
    case "ai_status": return { available: true, version: "2.1.288 (Claude Code)", mcpRegistered: true };
    case "ai_token_status": return { saved: false };
    case "ai_token_open_setup": return null;
    case "ai_token_save": if (!String(a?.token ?? "").startsWith("sk-ant-")) throw "That does not look like a Claude token. Copy the whole line that starts with sk-ant-."; return null;
    case "ai_token_clear": return null;
    case "ai_providers": return mockProviders.map(({ secret, ...p }) => ({ ...p, hasKey: !!secret }));
    case "ai_provider_save": {
      const p = mockProviders.find((x) => x.id === a.id);
      if (!p) throw `Unknown provider ${a.id}`;
      if (typeof a.apiKey === "string") {
        if (a.apiKey.trim().startsWith("sk-ant-oat")) throw "That is a Claude subscription sign-in token. Worlds cannot use those; create an API key in the Claude Console, or use Claude Code.";
        p.secret = a.apiKey.trim();
      }
      if (typeof a.baseUrl === "string") p.baseUrl = a.baseUrl.trim() || p.defaultBaseUrl;
      const { secret, ...rest } = p;
      return { ...rest, hasKey: !!secret };
    }
    case "ai_provider_models": return a.id === "ollama" ? [{ id: "llama3.2:3b", name: "llama3.2:3b", tools: true }, { id: "gemma:2b", name: "gemma:2b", tools: false }] : [{ id: "gpt-5", name: "gpt-5", tools: null }];
    case "ai_local_detect": return mockProviders.filter((p) => p.kind === "local").map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, running: p.id === "ollama", models: p.id === "ollama" ? [{ id: "llama3.2:3b", name: "llama3.2:3b", tools: true }] : [] }));
    case "ai_codex_status": return { installed: true, signedIn: false, version: "codex-cli 0.144.5", method: "" };
    case "ai_claude_auth_status": return { installed: true, signedIn: true, method: "claude.ai" };
    case "ai_codex_login": case "ai_claude_login": return null;
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
      if (WEB_DEMO || new URLSearchParams(location.search).has("demo")) {
        // Simulated events only; no service, network, or real workspace writes.
        // A reply drawn from the demo's own pages, in the language of the question, that says plainly it is the demo.
        const arabicPrompt = /[\u0600-\u06FF]/.test(String(a.request.prompt ?? ""));
        const recent = Object.values(pages)
          .filter((p: any) => !p.deletedAt && p.kind !== "template" && p.title)
          .sort((x: any, y: any) => y.updatedAt - x.updatedAt)
          .slice(0, 5)
          .map((p: any) => `- ${p.title}`)
          .join("\n");
        const answer = arabicPrompt
          ? `**من مساحة عملك**\n\nآخر ما عملت عليه:\n${recent}\n\nهذه نسخة الويب التجريبية. في تطبيق سطح المكتب يقرأ Claude صفحاتك ويكتب فيها فعلًا، ويمكن التراجع عن كل تغيير.`
          : `**From your workspace**\n\nWhat you worked on most recently:\n${recent}\n\nThis is the web demo. In the desktop app Claude really reads and writes your pages, and every change can be undone.`;
        setTimeout(() => emit("worlds://ai", { runId, kind: "tool", tool: "pages_read" }), 300);
        setTimeout(() => emit("worlds://ai", { runId, kind: "tool_result", error: false }), 800);
        setTimeout(() => emit("worlds://ai", { runId, kind: "text", text: answer }), 1100);
        setTimeout(() => {
          chatMessages[chatId].push({ id: id(), role: "assistant", content: answer, steps: [{ tool: "pages_read", ok: true }], opId: null, meta: { changeCount: 0 }, createdAt: Date.now() });
          emit("worlds://ai", { runId, kind: "done", chatId, text: "ok" });
        }, 1700);
        return { runId, chatId };
      }
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
    case "automations_list": return new URLSearchParams(location.search).has("demo") ? [{
      id: "demo-automation", name: "Demo · Weekly update", enabled: false,
      spec: { trigger: { kind: "weekly", days: [1], time: "09:00" }, source: { pageId: p1 }, transform: { kind: "none" }, action: { kind: "discord.send" }, destination: { kind: "channel", id: "demo-channel", label: "#announcements (demo)" }, policy: { unattended: false } },
      nextRunAt: null, lastRunAt: now - 86_400_000, createdAt: now - 14 * 86_400_000, updatedAt: now - 86_400_000, lastStatus: "succeeded",
    }] : [];
    case "automation_runs": return new URLSearchParams(location.search).has("demo") && (!a.automationId || a.automationId === "demo-automation") ? [{
      id: "demo-run", automationId: "demo-automation", status: "succeeded", trigger: "scheduled", scheduledFor: now - 86_400_000, startedAt: now - 86_400_000, finishedAt: now - 86_400_000 + 1000, versionId: null, output: null, error: null,
    }] : [];
    case "automation_run_now": if (new URLSearchParams(location.search).has("demo")) throw new Error("This demonstration automation cannot send messages."); return null;
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
    case "tray_language": return null;
    default:
      console.warn("[mock] unhandled", cmd, a);
      return null;
  }
}

export function mockFileUrl(attachmentId: string): string {
  return ASSET[attachmentId] ?? "";
}

if (!("__TAURI_INTERNALS__" in window) && (WEB_DEMO || (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")))) {
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
