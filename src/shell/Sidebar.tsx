import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ProductIcon, type ProductIconName } from "../ui/ProductIcon";
import { useStore, childrenOf, pageTitle, type Route } from "../state/store";
import type { PageMeta } from "../lib/types";
import { Icon, type IconName } from "../ui/Icon";
import { IconButton } from "../ui/Button";
import { Avatar, PageIcon } from "../ui/misc";
import { useMenu, menuAt } from "../ui/Menu";
import { pageMenu, renameRequests } from "./pageActions";
import { api, errorMessage } from "../lib/api";
import { isResource } from "../resources/kinds";
import { newResourceMenu } from "../resources/create";

const ROW_H = 30;

interface Row {
  page: PageMeta;
  depth: number;
  hasKids: boolean;
  open: boolean;
}

function flatten(pages: Record<string, PageMeta>, expanded: Record<string, boolean>): Row[] {
  const rows: Row[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of childrenOf(pages, parent)) {
      const kids = childrenOf(pages, p.id);
      const open = !!expanded[p.id];
      rows.push({ page: p, depth, hasKids: kids.length > 0, open });
      if (open && depth < 24) walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function useActiveRoute(): Route | null {
  return useStore((s) => {
    const pane = s.layout.panes.find((p) => p.id === s.layout.activePaneId);
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId);
    return tab?.route ?? null;
  });
}

export function Sidebar() {
  const sidebar = useStore((s) => s.sidebar);
  const pages = useStore((s) => s.pages);
  const profile = useStore((s) => s.profile);
  const pendingCount = useStore((s) => s.pendingCount);
  const open = useStore((s) => s.open);
  const createPage = useStore((s) => s.createPage);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setPalette = useStore((s) => s.setPalette);
  const active = useActiveRoute();

  const rows = useMemo(() => flatten(pages, sidebar.expanded), [pages, sidebar.expanded]);
  const pinned = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.pinned && !p.deletedAt && isResource(p))
        .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0)),
    [pages],
  );

  const isActive = (r: Route) => !!active && (JSON.stringify(active) === JSON.stringify(r) || (r.kind === "chat" && active.kind === "chat"));
  const nav = (icon: IconName, label: string, route: Route, badge?: number, product?: ProductIconName) => (
    <button
      className={`side-item ${isActive(route) ? "is-active" : ""}`}
      onClick={(e) => open(route, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
    >
      {product ? <ProductIcon name={product} size={34} className="side-pi" /> : <Icon name={icon} size={19} />}
      <span className="side-label">{label}</span>
      {badge ? <span className="side-badge">{badge}</span> : null}
    </button>
  );

  // Resizing
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebar.width;
    const move = (ev: PointerEvent) => useStore.getState().setSidebarWidth(startW + ev.clientX - startX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-resizing");
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside className={`sidebar ${sidebar.collapsed ? "is-collapsed" : ""}`} style={{ width: sidebar.collapsed ? 0 : sidebar.width }} aria-label="Sidebar">
      <div className="sidebar-inner" style={{ width: sidebar.width }}>
        <div className="side-top" data-drag-zone>
          <IconButton icon="sidebarClose" label="Hide sidebar" shortcut="Ctrl+\" onClick={toggleSidebar} />
          <div className="side-top-spacer" data-tauri-drag-region />
          <IconButton icon="search" label="Search" shortcut="Ctrl+K" onClick={() => setPalette(true, "all")} />
          <IconButton icon="edit" label="New" shortcut="Ctrl+N for a page" onClick={(e) => newResourceMenu(e.currentTarget)} />
        </div>

        <nav className="side-nav">
          {nav("home", "Home", { kind: "home" }, undefined, "home")}
          {nav("assistant", "Claude", { kind: "chat" }, undefined, "claude")}
          {pendingCount > 0 && nav("inbox", "Needs approval", { kind: "activity" }, pendingCount)}
        </nav>

        <div className="side-scroll scroll">
          {pinned.length > 0 && (
            <Section title="Pinned">
              {pinned.map((p) => (
                <PinnedRow key={p.id} page={p} active={isActive({ kind: "page", pageId: p.id }) ?? false} />
              ))}
            </Section>
          )}

          <Section
            title="Pages"
            action={<IconButton icon="add" label="New page" className="side-section-action" onClick={() => createPage({}, "current")} />}
          >
            {rows.length === 0 ? (
              <button className="side-empty" onClick={() => createPage({}, "current")}>
                <Icon name="add" size={14} />
                <span>New page</span>
              </button>
            ) : (
              <Tree rows={rows} activeRoute={active} />
            )}
          </Section>

          <Section title="Library">
            {nav("template", "Templates", { kind: "templates" }, undefined, "templates")}
            {nav("automation", "Automations", { kind: "automations" }, undefined, "automations")}
            {nav("layers", "Integrations", { kind: "integrations" }, undefined, "integrations")}
            {nav("activity", "Activity", { kind: "activity" }, undefined, "activity")}
            {nav("delete", "Trash", { kind: "trash" }, undefined, "trash")}
          </Section>
        </div>

        <div className="side-bottom">
          <button className={`side-profile ${isActive({ kind: "profile" }) ? "is-active" : ""}`} onClick={() => open({ kind: "profile" })}>
            <Avatar id={profile?.avatar} name={profile?.displayName} size={26} />
            <span className="side-profile-name bidi">{profile?.displayName || "Profile"}</span>
          </button>
          <IconButton icon="settings" label="Settings" shortcut="Ctrl+," onClick={() => open({ kind: "settings" })} />
        </div>
      </div>
      {!sidebar.collapsed && <div className="side-resize" onPointerDown={startResize} onDoubleClick={() => useStore.getState().setSidebarWidth(268)} />}
    </aside>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="side-section">
      <header className="side-section-head">
        <span>{title}</span>
        {action}
      </header>
      <div className="side-section-body">{children}</div>
    </section>
  );
}

function PinnedRow({ page, active }: { page: PageMeta; active: boolean }) {
  const openPage = useStore((s) => s.openPage);
  const show = useMenu((s) => s.show);
  return (
    <button
      className={`side-item side-page ${active ? "is-active" : ""}`}
      onClick={(e) => openPage(page.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
      onContextMenu={(e) => {
        e.preventDefault();
        show(e.clientX, e.clientY, pageMenu(page));
      }}
    >
      <PageIcon icon={page.icon} size={19} />
      <span className="side-label bidi">{pageTitle(page)}</span>
    </button>
  );
}

type DropZone = { id: string; zone: "before" | "after" | "inside" } | null;

function Tree({ rows, activeRoute }: { rows: Row[]; activeRoute: Route | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<DropZone>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const insideTimer = useRef<{ id: string; at: number } | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 400]);

  useEffect(() => {
    const onRename = (e: Event) => setRenaming((e as CustomEvent<string>).detail);
    renameRequests.addEventListener("rename", onRename);
    return () => renameRequests.removeEventListener("rename", onRename);
  }, []);

  // Virtualize only when the tree is genuinely long.
  const virtual = rows.length > 400;
  useEffect(() => {
    if (!virtual) return;
    const sc = scrollRef.current?.closest(".side-scroll") as HTMLElement | null;
    if (!sc) return;
    const onScroll = () => {
      const top = sc.scrollTop - (scrollRef.current?.offsetTop ?? 0);
      const first = Math.max(0, Math.floor(top / ROW_H) - 20);
      setRange([first, first + Math.ceil(sc.clientHeight / ROW_H) + 40]);
    };
    onScroll();
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => sc.removeEventListener("scroll", onScroll);
  }, [virtual]);

  const onDragOver = (e: DragEvent, row: Row) => {
    if (!e.dataTransfer.types.includes("application/x-worlds-page")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    let zone: "before" | "after" | "inside" = y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    if (zone === "inside") {
      // Dwell before re-parenting so a quick pass over a row never nests a page by accident.
      const t = insideTimer.current;
      if (!t || t.id !== row.page.id) {
        insideTimer.current = { id: row.page.id, at: performance.now() };
        zone = y < 0.5 ? "before" : "after";
      } else if (performance.now() - t.at < 380) {
        zone = y < 0.5 ? "before" : "after";
      }
    } else {
      insideTimer.current = null;
    }
    if (!drop || drop.id !== row.page.id || drop.zone !== zone) setDrop({ id: row.page.id, zone });
  };

  const onDrop = async (e: DragEvent, row: Row) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("application/x-worlds-page");
    const d = drop;
    setDrop(null);
    insideTimer.current = null;
    if (!id || !d || id === row.page.id) return;
    const s = useStore.getState();
    try {
      if (d.zone === "inside") {
        await api.movePage(id, row.page.id, null);
        s.setExpanded(row.page.id, true);
      } else if (d.zone === "before") {
        await api.movePage(id, row.page.parentId, row.page.id);
      } else {
        const sibs = childrenOf(s.pages, row.page.parentId).filter((x) => x.id !== id);
        const i = sibs.findIndex((x) => x.id === row.page.id);
        await api.movePage(id, row.page.parentId, sibs[i + 1]?.id ?? null);
      }
      await s.refreshPages();
    } catch (err) {
      s.toast({ message: errorMessage(err), tone: "error" });
    }
  };

  const visible = virtual ? rows.slice(range[0], range[1]) : rows;
  return (
    <div
      ref={scrollRef}
      className="tree"
      role="tree"
      style={virtual ? { height: rows.length * ROW_H, position: "relative" } : undefined}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop(null);
      }}
    >
      {visible.map((row, i) => (
        <TreeRow
          key={row.page.id}
          row={row}
          style={virtual ? { position: "absolute", top: (range[0] + i) * ROW_H, left: 0, right: 0 } : undefined}
          active={activeRoute?.kind === "page" && activeRoute.pageId === row.page.id}
          drop={drop?.id === row.page.id ? drop.zone : null}
          renaming={renaming === row.page.id}
          onRenameDone={() => setRenaming(null)}
          onDragOver={(e) => onDragOver(e, row)}
          onDrop={(e) => onDrop(e, row)}
        />
      ))}
    </div>
  );
}

function TreeRow({
  row,
  style,
  active,
  drop,
  renaming,
  onRenameDone,
  onDragOver,
  onDrop,
}: {
  row: Row;
  style?: React.CSSProperties;
  active: boolean;
  drop: "before" | "after" | "inside" | null;
  renaming: boolean;
  onRenameDone: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const { page, depth, hasKids, open } = row;
  const openPage = useStore((s) => s.openPage);
  const setExpanded = useStore((s) => s.setExpanded);
  const createPage = useStore((s) => s.createPage);
  const show = useMenu((s) => s.show);
  const [title, setTitle] = useState(page.title);

  useEffect(() => setTitle(page.title), [page.title, renaming]);

  const commitRename = async () => {
    onRenameDone();
    if (title !== page.title) {
      try {
        const m = await api.updatePage(page.id, { title });
        useStore.getState().patchPageLocal(m);
      } catch (e) {
        useStore.getState().toast({ message: errorMessage(e), tone: "error" });
      }
    }
  };

  return (
    <div
      className={`tree-row ${active ? "is-active" : ""} ${drop ? `drop-${drop}` : ""}`}
      style={{ ...style, ["--depth" as string]: depth }}
      role="treeitem"
      aria-expanded={hasKids ? open : undefined}
      aria-selected={active}
      tabIndex={0}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-worlds-page", page.id);
        e.dataTransfer.setData("text/plain", pageTitle(page));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={(e) => openPage(page.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
      onKeyDown={(e) => {
        if (renaming) return;
        if (e.key === "Enter") openPage(page.id);
        else if (e.key === "ArrowRight" && hasKids) setExpanded(page.id, true);
        else if (e.key === "ArrowLeft") setExpanded(page.id, false);
        else if (e.key === "F2") {
          e.preventDefault();
          import("./pageActions").then((m) => m.requestRename(page.id));
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const sib = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
          (sib as HTMLElement | null)?.focus();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        show(e.clientX, e.clientY, pageMenu(page));
      }}
    >
      <button
        className={`tree-twisty ${hasKids ? "" : "is-leaf"} ${open ? "is-open" : ""}`}
        tabIndex={-1}
        aria-label={open ? "Collapse" : "Expand"}
        onClick={(e) => {
          e.stopPropagation();
          if (hasKids) setExpanded(page.id, !open);
        }}
      >
        {hasKids ? <Icon name="forward" size={12} /> : <span className="tree-dot" />}
      </button>
      <PageIcon icon={page.icon} size={19} />
      {renaming ? (
        <input
          className="tree-rename bidi"
          dir="auto"
          autoFocus
          value={title}
          placeholder="Untitled"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTitle(page.title);
              onRenameDone();
            }
          }}
        />
      ) : (
        <span className={`tree-label bidi ${page.title ? "" : "is-untitled"}`}>{pageTitle(page)}</span>
      )}
      <span className="tree-actions">
        <IconButton
          icon="more"
          label="More"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            menuAt(e.currentTarget, pageMenu(page));
          }}
        />
        <IconButton
          icon="add"
          label="New subpage"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            createPage({ parentId: page.id }, "current");
          }}
        />
      </span>
    </div>
  );
}
