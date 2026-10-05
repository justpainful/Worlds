import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { emit } from "../lib/bus";
import type { SearchHit } from "../lib/types";
import { useStore, pageTitle, type OpenWhere, type Route } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Icon, type IconName } from "../ui/Icon";
import { PageIcon, relTime } from "../ui/misc";
import { pageOps } from "./pageActions";
import { isResource } from "../resources/kinds";
import { addStream, createResource, uploadFiles } from "../resources/create";

interface Cmd {
  id: string;
  title: string;
  icon: IconName;
  hint?: string;
  keywords?: string;
  run: (where: OpenWhere) => void;
}

interface Item {
  key: string;
  kind: "page" | "command" | "template";
  title: string;
  subtitle?: string;
  snippet?: string;
  icon?: IconName;
  emoji?: string | null;
  hint?: string;
  run: (where: OpenWhere) => void;
}

function activeRoute(): Route | null {
  const s = useStore.getState();
  const pane = s.layout.panes.find((p) => p.id === s.layout.activePaneId);
  return pane?.tabs.find((t) => t.id === pane.activeTabId)?.route ?? null;
}

function score(text: string, q: string): number {
  const t = text.toLowerCase();
  const query = q.toLowerCase().trim();
  if (!query) return 1;
  if (t.startsWith(query)) return 3;
  if (t.includes(query)) return 2;
  // subsequence match
  let i = 0;
  for (const ch of t) if (ch === query[i]) i++;
  return i === query.length ? 1 : 0;
}

function commands(): Cmd[] {
  const s = useStore.getState();
  const route = activeRoute();
  const page = route?.kind === "page" ? s.pages[route.pageId] : null;
  const list: Cmd[] = [
    { id: "new", title: "Create Page", icon: "add", hint: "Ctrl+N", keywords: "new page", run: (w) => s.createPage({}, w) },
    { id: "home", title: "Go Home", icon: "home", run: (w) => s.open({ kind: "home" }, w) },
    { id: "new-document", title: "New Document", icon: "text", keywords: "word write doc paper", run: () => createResource("document") },
    { id: "new-presentation", title: "New Presentation", icon: "monitor", keywords: "slides deck powerpoint keynote", run: () => createResource("presentation") },
    { id: "new-project", title: "New Project", icon: "folder", keywords: "folder organize", run: () => createResource("project") },
    { id: "new-gallery", title: "New Gallery", icon: "image", keywords: "photos album pictures videos", run: () => createResource("gallery") },
    { id: "upload", title: "Upload Files", icon: "upload", keywords: "import add file pdf video image", run: () => uploadFiles() },
    { id: "stream", title: "Add Stream Link", icon: "link", keywords: "m3u8 hls live video url", run: () => addStream() },
    { id: "templates", title: "Templates", icon: "template", keywords: "new from template", run: (w) => s.open({ kind: "templates" }, w) },
    { id: "automations", title: "Automations", icon: "automation", run: (w) => s.open({ kind: "automations" }, w) },
    { id: "auto-new", title: "Create Automation", icon: "schedule", keywords: "schedule discord send", run: () => emit("automation:new", { pageId: page?.id ?? null }) },
    { id: "ask", title: "Ask Claude", icon: "assistant", hint: "Ctrl+J", keywords: "ai assistant claude", run: () => emit("ai:open", { pageId: page?.id ?? null }) },
    { id: "chats", title: "Claude Conversations", icon: "assistant", keywords: "ai chats history claude", run: (w) => s.open({ kind: "chat" }, w) },
    { id: "split", title: "Split Right", icon: "splitRight", hint: "Ctrl+\\", run: () => route && s.open(route, "right") },
    { id: "splitl", title: "Split Left", icon: "splitLeft", run: () => route && s.open(route, "left") },
    { id: "collapse", title: "Back to One Pane", icon: "square", run: () => s.collapsePanes() },
    { id: "sidebar", title: "Toggle Sidebar", icon: "sidebarOpen", hint: "Ctrl+Shift+L", run: () => s.toggleSidebar() },
    { id: "integrations", title: "Integrations", icon: "layers", keywords: "discord bridge bot claude", run: (w) => s.open({ kind: "integrations" }, w) },
    { id: "activity", title: "Activity", icon: "activity", keywords: "history approvals", run: (w) => s.open({ kind: "activity" }, w) },
    { id: "profile", title: "Profile", icon: "profile", run: (w) => s.open({ kind: "profile" }, w) },
    { id: "settings", title: "Settings", icon: "settings", hint: "Ctrl+,", run: (w) => s.open({ kind: "settings" }, w) },
    { id: "appearance", title: "Settings: Appearance", icon: "appearance", keywords: "glass motion accent theme", run: (w) => s.open({ kind: "settings", section: "appearance" }, w) },
    { id: "trash", title: "Trash", icon: "delete", run: (w) => s.open({ kind: "trash" }, w) },
  ];
  if (page) {
    list.unshift(
      { id: "sub", title: "New Subpage", icon: "subpage", keywords: "child page", run: (w) => s.createPage({ parentId: page.id }, w) },
      { id: "pin", title: page.pinned ? "Unpin Page" : "Pin Page", icon: page.pinned ? "unpin" : "pin", run: () => pageOps.togglePin(page) },
      { id: "img", title: "Insert Image", icon: "image", keywords: "upload picture", run: () => emit("editor:command", { pageId: page.id, command: "insertImage" }) },
      { id: "file", title: "Insert File", icon: "file", keywords: "attach upload", run: () => emit("editor:command", { pageId: page.id, command: "insertFile" }) },
      { id: "discord", title: "Send to Discord", icon: "discord", keywords: "bridge bot publish preview", run: () => emit("discord:compose", { pageId: page.id }) },
      { id: "instructions", title: "Assistant Instructions", icon: "instructions", run: () => emit("page:info", { pageId: page.id, panel: "instructions" }) },
      { id: "history", title: "Page History", icon: "history", keywords: "versions restore", run: () => emit("page:info", { pageId: page.id, panel: "history" }) },
      { id: "dup", title: "Duplicate Page", icon: "duplicate", run: () => pageOps.duplicate(page) },
      { id: "tpl", title: "Save Page as Template", icon: "template", run: () => pageOps.saveAsTemplate(page) },
      { id: "archive", title: page.archived ? "Unarchive Page" : "Archive Page", icon: "archive", run: () => pageOps.archive(page) },
    );
  }
  if (s.settings["advanced.developer"]) {
    list.push({ id: "lab", title: "Material Lab", icon: "layers", keywords: "glass debug playground", run: (w) => s.open({ kind: "playground" }, w) });
  }
  return list;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const mode = useStore((s) => s.paletteMode);
  const setPalette = useStore((s) => s.setPalette);
  if (!open) return null;
  return <Palette mode={mode} onClose={() => setPalette(false)} />;
}

function Palette({ mode, onClose }: { mode: "all" | "pages" | "commands"; onClose: () => void }) {
  const pages = useStore((s) => s.pages);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState(0);
  const [shown, setShown] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);

  useEffect(() => {
    if (mode === "commands" || !q.trim()) {
      setHits([]);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(() => {
      api
        .search(q, 24, true)
        .then(setHits)
        .finally(() => setSearching(false));
    }, 70);
    return () => clearTimeout(t);
  }, [q, mode]);

  const items: Item[] = useMemo(() => {
    const s = useStore.getState();
    const out: Item[] = [];
    const query = q.trim();
    if (mode !== "commands") {
      if (!query) {
        const recent = Object.values(pages)
          .filter((p) => isResource(p) && !p.deletedAt && !p.archived)
          .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt))
          .slice(0, 6);
        for (const p of recent) {
          out.push({
            key: `p${p.id}`,
            kind: "page",
            title: pageTitle(p),
            subtitle: p.parentId ? pageTitle(pages[p.parentId]) : relTime(p.openedAt ?? p.updatedAt),
            emoji: p.icon,
            icon: "page",
            run: (w) => s.openPage(p.id, w),
          });
        }
      } else {
        for (const h of hits) {
          const isTpl = h.kind === "template";
          out.push({
            key: `p${h.pageId}`,
            kind: isTpl ? "template" : "page",
            title: h.title || "Untitled",
            subtitle: isTpl ? "Template" : h.parentTitle ?? undefined,
            snippet: h.snippet,
            emoji: h.icon,
            icon: isTpl ? "template" : "page",
            run: (w) =>
              isTpl
                ? api.instantiate(h.pageId).then(async (m) => {
                    await s.refreshPages();
                    s.openPage(m.id, w);
                  })
                : s.openPage(h.pageId, w),
          });
        }
      }
    }
    if (mode !== "pages") {
      const cmds = commands()
        .map((c) => ({ c, sc: Math.max(score(c.title, query), score(c.keywords ?? "", query)) }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc)
        .slice(0, query ? 8 : 6);
      for (const { c } of cmds) {
        out.push({ key: `c${c.id}`, kind: "command", title: c.title, icon: c.icon, hint: c.hint, run: c.run });
      }
      if (query && mode !== "commands" && !hits.some((h) => h.title.toLowerCase() === query.toLowerCase())) {
        out.push({
          key: "create",
          kind: "command",
          title: `Create “${query}”`,
          icon: "add",
          run: (w) => s.createPage({ title: query }, w),
        });
      }
    }
    return out;
  }, [q, hits, mode, pages]);

  useEffect(() => setSel(0), [q, mode]);
  useEffect(() => {
    listRef.current?.querySelector(".pal-item.is-sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (i: number, where: OpenWhere = "current") => {
    const it = items[i];
    if (!it) return;
    onClose();
    it.run(where);
  };

  const groups: { label: string; items: [Item, number][] }[] = [];
  items.forEach((it, i) => {
    const label = it.kind === "command" ? "Commands" : q.trim() ? "Pages" : "Recent";
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push([it, i]);
    else groups.push({ label, items: [[it, i]] });
  });

  return createPortal(
    <div className={`palette-root ${shown ? "is-in" : ""}`}>
      <div className="palette-scrim" onPointerDown={onClose} />
      <Glass material="dense" layer={LAYER.modal} className="palette" radius="var(--r-float)" role="dialog" aria-label="Command palette">
        <div className="pal-input-row">
          <Icon name={searching ? "loading" : "search"} size={18} className={searching ? "spin" : ""} />
          <input
            autoFocus
            dir="auto"
            className="pal-input bidi"
            placeholder={mode === "commands" ? "Run a command" : mode === "pages" ? "Go to a page" : "Search pages or run a command"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((v) => Math.min(items.length - 1, v + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((v) => Math.max(0, v - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(sel, e.ctrlKey ? "tab" : e.altKey ? "right" : "current");
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-list scroll" ref={listRef} role="listbox">
          {items.length === 0 ? (
            <div className="pal-empty">
              <Icon name="search" size={18} />
              <div>
                <div className="pal-empty-title">No results</div>
                <div className="pal-empty-text bidi">Nothing matches “{q}”. Try fewer words, or press Enter to create it.</div>
              </div>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="pal-group">
                <div className="pal-group-label">{g.label}</div>
                {g.items.map(([it, i]) => (
                  <div
                    key={it.key}
                    role="option"
                    aria-selected={i === sel}
                    className={`pal-item ${i === sel ? "is-sel" : ""}`}
                    onPointerMove={() => i !== sel && setSel(i)}
                    onClick={(e) => choose(i, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
                  >
                    <span className="pal-item-icon">{it.emoji ? <PageIcon icon={it.emoji} size={16} /> : it.icon ? <Icon name={it.icon} size={16} /> : null}</span>
                    <span className="pal-item-main">
                      <span className="pal-item-title bidi">{it.title}</span>
                      {it.snippet ? (
                        <span className="pal-item-snippet bidi">
                          {it.snippet.split(/([^]*)/).map((part, k) =>
                            part.startsWith("") ? <mark key={k}>{part.slice(1, -1)}</mark> : <span key={k}>{part}</span>,
                          )}
                        </span>
                      ) : it.subtitle ? (
                        <span className="pal-item-sub bidi">{it.subtitle}</span>
                      ) : null}
                    </span>
                    {it.hint && <kbd>{it.hint}</kbd>}
                    {i === sel && it.kind !== "command" && <span className="pal-item-enter">↵</span>}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="pal-foot">
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Ctrl ↵</kbd> New tab</span>
          <span><kbd>Alt ↵</kbd> Open right</span>
        </div>
      </Glass>
    </div>,
    document.body,
  );
}
