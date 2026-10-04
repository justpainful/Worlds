import { create } from "zustand";
import { api, errorMessage, type NewPage } from "../lib/api";
import type { PageMeta, Profile } from "../lib/types";

// ---------------------------------------------------------------------------
// Routes, tabs, panes
// ---------------------------------------------------------------------------

export type Route =
  | { kind: "home" }
  | { kind: "page"; pageId: string }
  | { kind: "templates" }
  | { kind: "automations"; automationId?: string }
  | { kind: "settings"; section?: string }
  | { kind: "profile" }
  | { kind: "activity" }
  | { kind: "integrations" }
  | { kind: "trash" }
  | { kind: "playground" }
  | { kind: "chat"; chatId?: string };

export interface Tab {
  id: string;
  route: Route;
  back: Route[];
  forward: Route[];
  scroll?: Record<string, number>;
}

export interface Pane {
  id: string;
  tabs: Tab[];
  activeTabId: string;
}

export interface Layout {
  panes: Pane[];
  activePaneId: string;
  /** Relative widths, one per pane. */
  widths: number[];
}

export type OpenWhere = "current" | "tab" | "right" | "left";

const MAX_PANES = 3;
let idc = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(idc++).toString(36)}`;

const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

function newTab(route: Route): Tab {
  return { id: uid("t"), route, back: [], forward: [] };
}

function defaultLayout(): Layout {
  const tab = newTab({ kind: "home" });
  const pane: Pane = { id: uid("p"), tabs: [tab], activeTabId: tab.id };
  return { panes: [pane], activePaneId: pane.id, widths: [1] };
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export interface Toast {
  id: string;
  message: string;
  tone?: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface State {
  ready: boolean;
  profile: Profile | null;
  pages: Record<string, PageMeta>;
  settings: Record<string, unknown>;
  dataDir: string;
  layout: Layout;
  sidebar: { collapsed: boolean; width: number; expanded: Record<string, boolean> };
  paletteOpen: boolean;
  paletteMode: "all" | "pages" | "commands";
  toasts: Toast[];
  /** Bumped when another process changed a page, so open editors reload. */
  externalRevision: Record<string, number>;
  pendingCount: number;
  windowActive: boolean;
  maximized: boolean;

  init: () => Promise<void>;
  refreshPages: () => Promise<void>;
  setProfile: (p: Profile) => void;
  setSetting: (key: string, value: unknown) => void;

  open: (route: Route, where?: OpenWhere, paneId?: string) => void;
  openPage: (pageId: string, where?: OpenWhere) => void;
  goBack: (paneId: string) => void;
  goForward: (paneId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  closeTab: (paneId: string, tabId: string) => void;
  closePane: (paneId: string) => void;
  collapsePanes: () => void;
  moveTab: (fromPane: string, tabId: string, toPane: string, index: number) => void;
  focusPane: (paneId: string) => void;
  setWidths: (w: number[]) => void;
  setTabScroll: (tabId: string, key: string, top: number) => void;

  createPage: (input?: NewPage, where?: OpenWhere) => Promise<PageMeta | null>;
  patchPageLocal: (meta: PageMeta) => void;

  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setExpanded: (id: string, open: boolean) => void;

  setPalette: (open: boolean, mode?: "all" | "pages" | "commands") => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  bumpExternal: (pageId: string) => void;
  setPendingCount: (n: number) => void;
  setWindowState: (active: boolean, maximized: boolean) => void;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  profile: null,
  pages: {},
  settings: {},
  dataDir: "",
  layout: defaultLayout(),
  sidebar: { collapsed: false, width: 268, expanded: {} },
  paletteOpen: false,
  paletteMode: "all",
  toasts: [],
  externalRevision: {},
  pendingCount: 0,
  windowActive: true,
  maximized: false,

  init: async () => {
    const boot = await api.bootstrap();
    const pages: Record<string, PageMeta> = {};
    for (const p of boot.pages) pages[p.id] = p;
    const session = boot.settings["session"] as { layout?: Layout; sidebar?: State["sidebar"] } | undefined;
    let layout = session?.layout && validLayout(session.layout) ? session.layout : defaultLayout();
    // Drop tabs that point at pages that no longer exist.
    layout = sanitizeLayout(layout, pages);
    set({
      ready: true,
      profile: boot.profile,
      pages,
      settings: boot.settings,
      dataDir: boot.dataDir,
      layout,
      sidebar: { ...get().sidebar, ...(session?.sidebar ?? {}) },
    });
    // Tell the user once if launch restored or recovered the database.
    api
      .backups()
      .then((b) => b.note && get().toast({ message: b.note, tone: "info" }))
      .catch(() => {});
  },

  refreshPages: async () => {
    try {
      const list = await api.pages();
      const pages: Record<string, PageMeta> = {};
      for (const p of list) pages[p.id] = p;
      set({ pages });
    } catch (e) {
      get().toast({ message: errorMessage(e), tone: "error" });
    }
  },

  setProfile: (profile) => set({ profile }),

  setSetting: (key, value) => {
    set({ settings: { ...get().settings, [key]: value } });
    api.setSetting(key, value).catch((e) => get().toast({ message: errorMessage(e), tone: "error" }));
  },

  open: (route, where = "current", paneId) => {
    const { layout } = get();
    const targetId = paneId ?? layout.activePaneId;
    const pIndex = Math.max(0, layout.panes.findIndex((p) => p.id === targetId));
    const pane = layout.panes[pIndex];
    let panes = layout.panes.map((p) => ({ ...p, tabs: [...p.tabs] }));
    let widths = [...layout.widths];
    let activePaneId = pane.id;

    if (where === "right" || where === "left") {
      if (panes.length < MAX_PANES) {
        const tab = newTab(route);
        const np: Pane = { id: uid("p"), tabs: [tab], activeTabId: tab.id };
        const at = where === "right" ? pIndex + 1 : pIndex;
        panes.splice(at, 0, np);
        const share = 1 / panes.length;
        widths = panes.map(() => share);
        activePaneId = np.id;
      } else {
        // Already at max panes: open as a tab in the neighbour.
        const ni = where === "right" ? Math.min(panes.length - 1, pIndex + 1) : Math.max(0, pIndex - 1);
        const tab = newTab(route);
        panes[ni].tabs.push(tab);
        panes[ni].activeTabId = tab.id;
        activePaneId = panes[ni].id;
      }
    } else if (where === "tab") {
      const existing = panes[pIndex].tabs.find((t) => sameRoute(t.route, route));
      if (existing) panes[pIndex].activeTabId = existing.id;
      else {
        const tab = newTab(route);
        const ai = panes[pIndex].tabs.findIndex((t) => t.id === panes[pIndex].activeTabId);
        panes[pIndex].tabs.splice(ai + 1, 0, tab);
        panes[pIndex].activeTabId = tab.id;
      }
    } else {
      const p = panes[pIndex];
      const ti = p.tabs.findIndex((t) => t.id === p.activeTabId);
      const tab = p.tabs[ti];
      if (!sameRoute(tab.route, route)) {
        p.tabs[ti] = { ...tab, route, back: [...tab.back, tab.route].slice(-50), forward: [] };
      }
    }
    set({ layout: { panes, widths, activePaneId } });
  },

  openPage: (pageId, where = "current") => {
    get().open({ kind: "page", pageId }, where);
  },

  goBack: (paneId) => {
    mutateTab(paneId, (t) => {
      const prev = t.back[t.back.length - 1];
      if (!prev) return t;
      return { ...t, route: prev, back: t.back.slice(0, -1), forward: [t.route, ...t.forward] };
    });
  },

  goForward: (paneId) => {
    mutateTab(paneId, (t) => {
      const next = t.forward[0];
      if (!next) return t;
      return { ...t, route: next, back: [...t.back, t.route], forward: t.forward.slice(1) };
    });
  },

  activateTab: (paneId, tabId) => {
    const { layout } = get();
    set({
      layout: {
        ...layout,
        activePaneId: paneId,
        panes: layout.panes.map((p) => (p.id === paneId ? { ...p, activeTabId: tabId } : p)),
      },
    });
  },

  closeTab: (paneId, tabId) => {
    const { layout } = get();
    const pane = layout.panes.find((p) => p.id === paneId);
    if (!pane) return;
    const idx = pane.tabs.findIndex((t) => t.id === tabId);
    const tabs = pane.tabs.filter((t) => t.id !== tabId);
    if (tabs.length === 0) {
      if (layout.panes.length > 1) return get().closePane(paneId);
      const t = newTab({ kind: "home" });
      set({ layout: { ...layout, panes: [{ ...pane, tabs: [t], activeTabId: t.id }] } });
      return;
    }
    const activeTabId = pane.activeTabId === tabId ? tabs[Math.min(idx, tabs.length - 1)].id : pane.activeTabId;
    set({
      layout: { ...layout, panes: layout.panes.map((p) => (p.id === paneId ? { ...p, tabs, activeTabId } : p)) },
    });
  },

  closePane: (paneId) => {
    const { layout } = get();
    if (layout.panes.length <= 1) return;
    const i = layout.panes.findIndex((p) => p.id === paneId);
    const panes = layout.panes.filter((p) => p.id !== paneId);
    const widths = layout.widths.filter((_, j) => j !== i);
    const sum = widths.reduce((a, b) => a + b, 0) || 1;
    set({
      layout: {
        panes,
        widths: widths.map((w) => w / sum),
        activePaneId: layout.activePaneId === paneId ? panes[Math.max(0, i - 1)].id : layout.activePaneId,
      },
    });
  },

  collapsePanes: () => {
    const { layout } = get();
    const keep = layout.panes.find((p) => p.id === layout.activePaneId) ?? layout.panes[0];
    // Merge other panes' tabs into the kept one so nothing is lost.
    const extra = layout.panes.filter((p) => p.id !== keep.id).flatMap((p) => p.tabs);
    const seen = new Set(keep.tabs.map((t) => JSON.stringify(t.route)));
    const tabs = [...keep.tabs, ...extra.filter((t) => !seen.has(JSON.stringify(t.route)))];
    set({ layout: { panes: [{ ...keep, tabs }], widths: [1], activePaneId: keep.id } });
  },

  moveTab: (fromPane, tabId, toPane, index) => {
    const { layout } = get();
    const from = layout.panes.find((p) => p.id === fromPane);
    const tab = from?.tabs.find((t) => t.id === tabId);
    if (!from || !tab) return;
    let panes = layout.panes.map((p) => {
      if (p.id === fromPane && p.id === toPane) {
        const tabs = p.tabs.filter((t) => t.id !== tabId);
        tabs.splice(Math.min(index, tabs.length), 0, tab);
        return { ...p, tabs };
      }
      if (p.id === fromPane) {
        const tabs = p.tabs.filter((t) => t.id !== tabId);
        return { ...p, tabs, activeTabId: p.activeTabId === tabId ? tabs[0]?.id ?? "" : p.activeTabId };
      }
      if (p.id === toPane) {
        const tabs = [...p.tabs];
        tabs.splice(Math.min(index, tabs.length), 0, tab);
        return { ...p, tabs, activeTabId: tab.id };
      }
      return p;
    });
    let widths = layout.widths;
    const emptyIdx = panes.findIndex((p) => p.tabs.length === 0);
    if (emptyIdx >= 0) {
      panes = panes.filter((_, i) => i !== emptyIdx);
      widths = widths.filter((_, i) => i !== emptyIdx);
      const sum = widths.reduce((a, b) => a + b, 0) || 1;
      widths = widths.map((w) => w / sum);
    }
    set({ layout: { panes, widths, activePaneId: toPane } });
  },

  focusPane: (paneId) => {
    const { layout } = get();
    if (layout.activePaneId !== paneId) set({ layout: { ...layout, activePaneId: paneId } });
  },

  setWidths: (widths) => set({ layout: { ...get().layout, widths } }),

  setTabScroll: (tabId, key, top) => {
    const { layout } = get();
    // Scroll is kept on the tab object without triggering re-render storms.
    for (const p of layout.panes) {
      const t = p.tabs.find((x) => x.id === tabId);
      if (t) {
        t.scroll = { ...(t.scroll ?? {}), [key]: top };
        scheduleSessionSave();
        return;
      }
    }
  },

  createPage: async (input = {}, where = "current") => {
    try {
      const meta = await api.createPage({ title: "", ...input });
      set({ pages: { ...get().pages, [meta.id]: meta } });
      if (input.parentId) get().setExpanded(input.parentId, true);
      get().openPage(meta.id, where);
      return meta;
    } catch (e) {
      get().toast({ message: errorMessage(e), tone: "error" });
      return null;
    }
  },

  patchPageLocal: (meta) => set({ pages: { ...get().pages, [meta.id]: meta } }),

  toggleSidebar: () => set({ sidebar: { ...get().sidebar, collapsed: !get().sidebar.collapsed } }),
  setSidebarWidth: (w) => set({ sidebar: { ...get().sidebar, width: Math.round(Math.min(420, Math.max(220, w))) } }),
  setExpanded: (id, open) =>
    set({ sidebar: { ...get().sidebar, expanded: { ...get().sidebar.expanded, [id]: open } } }),

  setPalette: (open, mode = "all") => set({ paletteOpen: open, paletteMode: mode }),

  toast: (t) => {
    const id = uid("toast");
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    window.setTimeout(() => get().dismissToast(id), t.action ? 7000 : 4200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  bumpExternal: (pageId) =>
    set({ externalRevision: { ...get().externalRevision, [pageId]: (get().externalRevision[pageId] ?? 0) + 1 } }),
  setPendingCount: (n) => set({ pendingCount: n }),
  setWindowState: (windowActive, maximized) => set({ windowActive, maximized }),
}));

function mutateTab(paneId: string, fn: (t: Tab) => Tab) {
  const { layout } = useStore.getState();
  useStore.setState({
    layout: {
      ...layout,
      panes: layout.panes.map((p) =>
        p.id === paneId ? { ...p, tabs: p.tabs.map((t) => (t.id === p.activeTabId ? fn(t) : t)) } : p,
      ),
    },
  });
}

function validLayout(l: Layout): boolean {
  return Array.isArray(l?.panes) && l.panes.length > 0 && l.panes.every((p) => Array.isArray(p.tabs) && p.tabs.length > 0);
}

function sanitizeLayout(l: Layout, pages: Record<string, PageMeta>): Layout {
  const ok = (r: Route) => r.kind !== "page" || (pages[r.pageId] && !pages[r.pageId].deletedAt);
  const panes = l.panes
    .map((p) => {
      const tabs = p.tabs
        .filter((t) => ok(t.route))
        .map((t) => ({ ...t, back: (t.back ?? []).filter(ok), forward: (t.forward ?? []).filter(ok) }));
      return { ...p, tabs, activeTabId: tabs.find((t) => t.id === p.activeTabId)?.id ?? tabs[0]?.id ?? "" };
    })
    .filter((p) => p.tabs.length > 0);
  if (panes.length === 0) return defaultLayout();
  const widths = panes.length === l.widths?.length ? l.widths : panes.map(() => 1 / panes.length);
  const activePaneId = panes.find((p) => p.id === l.activePaneId)?.id ?? panes[0].id;
  return { panes, widths, activePaneId };
}

// ---------------------------------------------------------------------------
// Session persistence (debounced)
// ---------------------------------------------------------------------------

let saveTimer = 0;
function scheduleSessionSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const { layout, sidebar, ready } = useStore.getState();
    if (!ready) return;
    api.saveSession({ layout, sidebar }).catch(() => {});
  }, 600);
}

useStore.subscribe((s, prev) => {
  if (s.layout !== prev.layout || s.sidebar !== prev.sidebar) scheduleSessionSave();
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function childrenOf(pages: Record<string, PageMeta>, parentId: string | null, opts: { archived?: boolean } = {}) {
  return Object.values(pages)
    .filter(
      (p) =>
        p.parentId === parentId &&
        p.kind === "page" &&
        !p.deletedAt &&
        (opts.archived ? true : !p.archived),
    )
    .sort((a, b) => a.sortKey - b.sortKey || a.createdAt - b.createdAt);
}

export function pageTitle(p: PageMeta | undefined | null): string {
  if (!p) return "Missing page";
  return p.title.trim() || "Untitled";
}
