/**
 * Development-only stand-in for the Tauri backend, so the interface can be
 * reviewed in a plain browser (http://localhost:1420/?mock). It implements
 * the IPC surface with in-memory sample data. Never active in Worlds itself:
 * it only installs when there is no real Tauri runtime and the URL asks for it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

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

const settings: Record<string, unknown> = { "advanced.developer": true, "advanced.perfOverlay": new URLSearchParams(location.search).has("perf") };
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
    case "page_create": {
      const pid = addPage(a.page.title ?? "", a.page.icon ?? null, [], { kind: a.page.kind ?? "page", parentId: a.page.parentId ?? null });
      metadata[pid] = a.page.metadata ?? {};
      return pages[pid];
    }
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
