import { Fragment, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { useStore, pageTitle, type Pane, type Route, type Tab } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { GlassGroup, IconButton } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { PageIcon } from "../ui/misc";
import { menuAt, useMenu, type MenuItem } from "../ui/Menu";
import { useLens } from "../motion/useLens";
import { RouteView } from "../views/RouteView";
import { WindowControls } from "./Window";
import { glassScene } from "../glass/scene";

export function Panes() {
  const layout = useStore((s) => s.layout);
  const setWidths = useStore((s) => s.setWidths);
  const sidebarCollapsed = useStore((s) => s.sidebar.collapsed);
  const host = useRef<HTMLDivElement>(null);

  const startDrag = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    const el = host.current;
    if (!el) return;
    const total = el.getBoundingClientRect().width;
    const startX = e.clientX;
    const start = [...layout.widths];
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / total;
      const min = 300 / total;
      let a = start[i] + dx;
      let b = start[i + 1] - dx;
      if (a < min) {
        b -= min - a;
        a = min;
      }
      if (b < min) {
        a -= min - b;
        b = min;
      }
      const w = [...start];
      w[i] = a;
      w[i + 1] = b;
      setWidths(w);
      glassScene.invalidate();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-resizing-x");
    };
    document.body.classList.add("is-resizing-x");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className={`panes ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`} ref={host}>
      {layout.panes.map((pane, i) => (
        <Fragment key={pane.id}>
          {i > 0 && (
            <div
              className="split-handle"
              role="separator"
              aria-orientation="vertical"
              onPointerDown={(e) => startDrag(i - 1, e)}
              onDoubleClick={() => setWidths(layout.panes.map(() => 1 / layout.panes.length))}
            >
              <Glass material="clear" layer={LAYER.floating} className="split-grip" radius="var(--r-capsule)" responsive={false} />
            </div>
          )}
          <PaneView
            pane={pane}
            index={i}
            count={layout.panes.length}
            active={pane.id === layout.activePaneId}
            width={layout.widths[i] ?? 1 / layout.panes.length}
            first={i === 0}
            last={i === layout.panes.length - 1}
          />
        </Fragment>
      ))}
    </div>
  );
}

export function routeLabel(route: Route, pages: ReturnType<typeof useStore.getState>["pages"]): { title: string; icon: IconName | null; emoji: string | null } {
  switch (route.kind) {
    case "page": {
      const p = pages[route.pageId];
      return { title: pageTitle(p), icon: p?.icon ? null : "page", emoji: p?.icon ?? null };
    }
    case "home":
      return { title: "Home", icon: "home", emoji: null };
    case "templates":
      return { title: "Templates", icon: "template", emoji: null };
    case "automations":
      return { title: "Automations", icon: "automation", emoji: null };
    case "settings":
      return { title: "Settings", icon: "settings", emoji: null };
    case "profile":
      return { title: "Profile", icon: "profile", emoji: null };
    case "activity":
      return { title: "Activity", icon: "activity", emoji: null };
    case "integrations":
      return { title: "Integrations", icon: "layers", emoji: null };
    case "trash":
      return { title: "Trash", icon: "delete", emoji: null };
    case "playground":
      return { title: "Material Lab", icon: "layers", emoji: null };
    case "chat":
      return { title: "Claude", icon: "assistant", emoji: null };
  }
}

type DropSide = "left" | "right" | "center" | null;

function PaneView({ pane, index, count, active, width, first, last }: { pane: Pane; index: number; count: number; active: boolean; width: number; first: boolean; last: boolean }) {
  const focusPane = useStore((s) => s.focusPane);
  const tab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dropSide, setDropSide] = useState<DropSide>(null);
  const routeKey = JSON.stringify(tab.route);

  // Restore the scroll position remembered for this tab + route.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = tab.scroll?.[routeKey] ?? 0;
    el.scrollTop = saved;
    // Content may still be loading; try again once it has laid out.
    const t = window.setTimeout(() => {
      if (saved && el.scrollTop === 0) el.scrollTop = saved;
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, routeKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        useStore.getState().setTabScroll(tab.id, routeKey, el.scrollTop);
        el.classList.toggle("is-scrolled", el.scrollTop > 4);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [tab.id, routeKey]);

  const accepts = (e: DragEvent) =>
    e.dataTransfer.types.includes("application/x-worlds-tab") || e.dataTransfer.types.includes("application/x-worlds-page");

  const onDragOver = (e: DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const side: DropSide = x < 0.22 ? "left" : x > 0.78 ? "right" : "center";
    if (side !== dropSide) setDropSide(side);
  };

  const onDrop = (e: DragEvent) => {
    const side = dropSide;
    setDropSide(null);
    if (!accepts(e) || !side) return;
    e.preventDefault();
    const s = useStore.getState();
    const tabData = e.dataTransfer.getData("application/x-worlds-tab");
    if (tabData) {
      const { paneId, tabId } = JSON.parse(tabData) as { paneId: string; tabId: string };
      const src = s.layout.panes.find((p) => p.id === paneId)?.tabs.find((t) => t.id === tabId);
      if (!src) return;
      if (side === "center") {
        if (paneId !== pane.id) s.moveTab(paneId, tabId, pane.id, pane.tabs.length);
      } else {
        s.open(src.route, side, pane.id);
        if (!(paneId === pane.id && pane.tabs.length === 1)) s.closeTab(paneId, tabId);
      }
      return;
    }
    const pageId = e.dataTransfer.getData("application/x-worlds-page");
    if (pageId) s.open({ kind: "page", pageId }, side === "center" ? "current" : side, pane.id);
  };

  return (
    <section
      className={`pane ${active ? "is-active" : ""} ${first ? "is-first" : ""} ${last ? "is-last" : ""}`}
      style={{ flexBasis: `${(width * 100).toFixed(3)}%` }}
      onPointerDownCapture={() => focusPane(pane.id)}
      aria-label={`Pane ${index + 1} of ${count}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropSide(null);
      }}
      onDrop={onDrop}
    >
      <div className="pane-scroll scroll" ref={scrollRef} data-pane={pane.id}>
        <RouteView route={tab.route} paneId={pane.id} tabId={tab.id} key={`${tab.id}:${tab.route.kind === "chat" ? "chat" : routeKey}`} />
      </div>
      <PaneToolbar pane={pane} tab={tab} showWindowControls={last} count={count} />
      {dropSide && <div className={`pane-drop pane-drop-${dropSide}`} />}
    </section>
  );
}

function PaneToolbar({ pane, tab, showWindowControls, count }: { pane: Pane; tab: Tab; showWindowControls: boolean; count: number }) {
  const pages = useStore((s) => s.pages);
  const open = useStore((s) => s.open);
  const goBack = useStore((s) => s.goBack);
  const goForward = useStore((s) => s.goForward);
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const closePane = useStore((s) => s.closePane);
  const collapsePanes = useStore((s) => s.collapsePanes);
  const moveTab = useStore((s) => s.moveTab);
  const sidebarCollapsed = useStore((s) => s.sidebar.collapsed);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const isFirstPane = useStore((s) => s.layout.panes[0]?.id === pane.id);
  const show = useMenu((s) => s.show);
  const strip = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useLens(strip, lens, `[data-tab="${pane.activeTabId}"]`, [pane.activeTabId, pane.tabs.length, pages]);

  const tabMenu = (t: Tab): MenuItem[] => [
    { label: "Open Right", icon: "splitRight", onSelect: () => open(t.route, "right", pane.id) },
    { label: "Open Left", icon: "splitLeft", onSelect: () => open(t.route, "left", pane.id) },
    { label: "Duplicate Tab", icon: "duplicate", onSelect: () => open(t.route, "tab", pane.id) },
    { kind: "separator" },
    { label: "Close Tab", icon: "close", shortcut: "Ctrl+W", onSelect: () => closeTab(pane.id, t.id) },
    {
      label: "Close Other Tabs",
      disabled: pane.tabs.length < 2,
      onSelect: () => pane.tabs.filter((x) => x.id !== t.id).forEach((x) => closeTab(pane.id, x.id)),
    },
  ];

  const moreMenu = (): MenuItem[] => [
    { label: "New Tab", icon: "add", shortcut: "Ctrl+T", onSelect: () => open({ kind: "home" }, "tab", pane.id) },
    { label: "Split Right", icon: "splitRight", shortcut: "Ctrl+\\", disabled: count >= 3, onSelect: () => open(tab.route, "right", pane.id) },
    { label: "Split Left", icon: "splitLeft", disabled: count >= 3, onSelect: () => open(tab.route, "left", pane.id) },
    { kind: "separator" },
    { label: "Close Pane", icon: "close", disabled: count < 2, onSelect: () => closePane(pane.id) },
    { label: "Back to One Pane", icon: "square", disabled: count < 2, onSelect: () => collapsePanes() },
  ];

  const onStripDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-worlds-tab")) return;
    e.preventDefault();
    e.stopPropagation();
    const items = [...(strip.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? [])];
    let idx = items.length;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {
        idx = i;
        break;
      }
    }
    setDropIndex(idx);
  };

  return (
    <div className="pane-toolbar-wrap" data-drag-zone>
      <div className="tb-row">
        {isFirstPane && sidebarCollapsed && (
          <GlassGroup items={[{ icon: "sidebarOpen", label: "Show sidebar", shortcut: "Ctrl+Shift+L", onClick: toggleSidebar }]} />
        )}
        <GlassGroup
          className="tb-nav"
          items={[
            { icon: "back", label: "Back", shortcut: "Alt+←", disabled: tab.back.length === 0, onClick: () => goBack(pane.id) },
            { icon: "forward", label: "Forward", shortcut: "Alt+→", disabled: tab.forward.length === 0, onClick: () => goForward(pane.id) },
          ]}
        />
        <Glass material="regular" layer={LAYER.chrome} className="tb-tabs" radius="var(--r-capsule)">
          <div
            className="tab-strip"
            ref={strip}
            onDragOver={onStripDragOver}
            onDragLeave={() => setDropIndex(null)}
            onDrop={(e) => {
              const data = e.dataTransfer.getData("application/x-worlds-tab");
              const idx = dropIndex;
              setDropIndex(null);
              if (!data || idx === null) return;
              e.preventDefault();
              e.stopPropagation();
              const { paneId, tabId } = JSON.parse(data) as { paneId: string; tabId: string };
              moveTab(paneId, tabId, pane.id, idx);
            }}
            data-tauri-drag-region
          >
            <div className="tab-lens-wrap" aria-hidden>
              <Glass ref={lens} material="control" layer={LAYER.chrome + 0.5} selected className="tab-lens" radius="var(--r-capsule)" responsive={false} />
            </div>
            {pane.tabs.map((t, i) => {
              const lbl = routeLabel(t.route, pages);
              const isActive = t.id === pane.activeTabId;
              return (
                <div
                  key={t.id}
                  data-tab={t.id}
                  className={`tab ${isActive ? "is-active" : ""} ${dropIndex === i ? "drop-before" : ""} ${dropIndex === pane.tabs.length && i === pane.tabs.length - 1 ? "drop-after" : ""}`}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-worlds-tab", JSON.stringify({ paneId: pane.id, tabId: t.id }));
                    if (t.route.kind === "page") e.dataTransfer.setData("application/x-worlds-page", t.route.pageId);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => activateTab(pane.id, t.id)}
                  onAuxClick={(e) => e.button === 1 && closeTab(pane.id, t.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    show(e.clientX, e.clientY, tabMenu(t));
                  }}
                  onKeyDown={(e) => e.key === "Enter" && activateTab(pane.id, t.id)}
                >
                  {lbl.emoji ? <PageIcon icon={lbl.emoji} size={16} /> : lbl.icon ? <Icon name={lbl.icon} size={16} /> : null}
                  <span className="tab-title bidi">{lbl.title}</span>
                  {(pane.tabs.length > 1 || count > 1 || t.route.kind !== "home") && (
                    <button
                      className="tab-close"
                      aria-label="Close tab"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(pane.id, t.id);
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </div>
              );
            })}
            <IconButton icon="add" label="New tab" shortcut="Ctrl+T" className="tab-add" onClick={() => open({ kind: "home" }, "tab", pane.id)} />
          </div>
        </Glass>
        <div className="tb-fill" />
        <GlassGroup
          items={[
            ...(count < 3 ? [{ icon: "splitRight" as const, label: "Split right", onClick: () => open(tab.route, "right", pane.id) }] : []),
            ...(count > 1 ? [{ icon: "close" as const, label: "Close pane", onClick: () => closePane(pane.id) }] : []),
            { icon: "more" as const, label: "More", onClick: (e: React.MouseEvent<HTMLButtonElement>) => menuAt(e.currentTarget, moreMenu(), "end") },
          ]}
        />
        {showWindowControls && <WindowControls />}
      </div>
    </div>
  );
}
