import { api, errorMessage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore, childrenOf, pageTitle } from "../state/store";
import type { MenuItem } from "../ui/Menu";
import { isResource } from "../resources/kinds";
import { openShareSheet } from "../account/store";

export const renameRequests = new EventTarget();
export function requestRename(pageId: string) {
  renameRequests.dispatchEvent(new CustomEvent("rename", { detail: pageId }));
}

async function run<T>(fn: () => Promise<T>, done?: string): Promise<T | undefined> {
  const s = useStore.getState();
  try {
    const r = await fn();
    await s.refreshPages();
    if (done) s.toast({ message: done, tone: "success" });
    return r;
  } catch (e) {
    s.toast({ message: errorMessage(e), tone: "error" });
    return undefined;
  }
}

export const pageOps = {
  togglePin: (p: PageMeta) => run(() => api.updatePage(p.id, { pinned: !p.pinned })),
  toggleFavorite: (p: PageMeta) => run(() => api.updatePage(p.id, { favorite: !p.favorite })),
  archive: (p: PageMeta) =>
    run(async () => {
      await api.updatePage(p.id, { archived: !p.archived });
      if (!p.archived) {
        useStore.getState().toast({
          message: `Archived “${pageTitle(p)}”`,
          action: { label: "Undo", run: () => run(() => api.updatePage(p.id, { archived: false })) },
        });
      }
    }),
  remove: (p: PageMeta) =>
    run(async () => {
      await api.deletePage(p.id);
      const s = useStore.getState();
      // Close tabs showing the deleted page or its subpages.
      for (const pane of s.layout.panes) {
        for (const t of pane.tabs) {
          if (t.route.kind === "page" && (t.route.pageId === p.id || isDescendant(t.route.pageId, p.id))) {
            useStore.getState().closeTab(pane.id, t.id);
          }
        }
      }
      s.toast({
        message: `Moved “${pageTitle(p)}” to Trash`,
        action: { label: "Undo", run: () => run(() => api.restorePage(p.id)) },
      });
    }),
  duplicate: (p: PageMeta) =>
    run(async () => {
      const copy = await api.duplicatePage(p.id, true);
      useStore.getState().openPage(copy.id, "current");
    }),
  newSubpage: (p: PageMeta, where: "current" | "tab" | "right" = "current") =>
    useStore.getState().createPage({ parentId: p.id }, where),
  moveTo: (p: PageMeta, parentId: string | null) =>
    run(async () => {
      await api.movePage(p.id, parentId, null);
      if (parentId) useStore.getState().setExpanded(parentId, true);
    }),
  saveAsTemplate: (p: PageMeta) =>
    run(async () => {
      await api.saveTemplate(p.id);
    }, "Saved as a template"),
};

function isDescendant(id: string, ancestor: string): boolean {
  const pages = useStore.getState().pages;
  let cur = pages[id];
  let guard = 0;
  while (cur?.parentId && guard++ < 64) {
    if (cur.parentId === ancestor) return true;
    cur = pages[cur.parentId];
  }
  return false;
}

/** Destinations for "Move to": top level plus recent pages that are not inside `p`. */
function moveTargets(p: PageMeta): MenuItem[] {
  const pages = useStore.getState().pages;
  const candidates = Object.values(pages)
    .filter((x) => isResource(x) && !x.deletedAt && !x.archived && x.id !== p.id && x.id !== p.parentId && !isDescendant(x.id, p.id))
    .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt))
    .slice(0, 12);
  const items: MenuItem[] = [];
  if (p.parentId) items.push({ label: "Top level", icon: "pages", onSelect: () => pageOps.moveTo(p, null) });
  if (items.length && candidates.length) items.push({ kind: "separator" });
  for (const c of candidates) items.push({ label: pageTitle(c), icon: "page", onSelect: () => pageOps.moveTo(p, c.id) });
  if (!items.length) items.push({ kind: "label", label: "No other pages yet" });
  return items;
}

export function pageMenu(p: PageMeta, opts: { paneId?: string; inPage?: boolean } = {}): MenuItem[] {
  const s = useStore.getState();
  if (p.deletedAt) {
    return [
      { label: "Restore", icon: "restore", onSelect: () => run(() => api.restorePage(p.id)) },
    ];
  }
  const items: MenuItem[] = [];
  if (!opts.inPage) {
    items.push(
      { label: "Open", icon: "page", onSelect: () => s.openPage(p.id, "current") },
      { label: "Open in New Tab", icon: "tabs", shortcut: "Ctrl+Click", onSelect: () => s.openPage(p.id, "tab") },
      { label: "Open Right", icon: "splitRight", shortcut: "Alt+Click", onSelect: () => s.openPage(p.id, "right") },
      { label: "Open Left", icon: "splitLeft", onSelect: () => s.openPage(p.id, "left") },
      { kind: "separator" },
    );
  }
  items.push(
    { label: "New Subpage", icon: "subpage", onSelect: () => pageOps.newSubpage(p) },
    { kind: "separator" },
    { label: p.pinned ? "Unpin" : "Pin", icon: p.pinned ? "unpin" : "pin", onSelect: () => pageOps.togglePin(p) },
    { label: p.favorite ? "Remove from Favorites" : "Favorite", icon: "favorite", checked: p.favorite, onSelect: () => pageOps.toggleFavorite(p) },
  );
  if (!opts.inPage) items.push({ label: "Rename", icon: "edit", shortcut: "F2", onSelect: () => requestRename(p.id) });
  items.push(
    { label: "Duplicate", icon: "duplicate", onSelect: () => pageOps.duplicate(p) },
    { label: "Move to", icon: "move", submenu: moveTargets(p) },
    { label: "Share", icon: "share", onSelect: () => openShareSheet(p.id) },
    { label: "Save as Template", icon: "template", onSelect: () => pageOps.saveAsTemplate(p) },
    { kind: "separator" },
    { label: p.archived ? "Unarchive" : "Archive", icon: p.archived ? "unarchive" : "archive", onSelect: () => pageOps.archive(p) },
    { label: "Delete", icon: "delete", danger: true, onSelect: () => pageOps.remove(p) },
  );
  return items;
}

export function hasChildren(id: string) {
  return childrenOf(useStore.getState().pages, id).length > 0;
}
