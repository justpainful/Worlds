import { useMemo } from "react";
import { api, errorMessage } from "../lib/api";
import { useStore, pageTitle } from "../state/store";
import { EmptyState, PageIcon, relTime } from "../ui/misc";
import { confirmDialog } from "../ui/Modal";
import { Icon } from "../ui/Icon";
import { isResource } from "../resources/kinds";

export function TrashView() {
  const pages = useStore((s) => s.pages);
  const refresh = useStore((s) => s.refreshPages);
  // Show only the roots of deleted subtrees.
  const trashed = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.deletedAt && !(p.parentId && pages[p.parentId]?.deletedAt === p.deletedAt))
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [pages],
  );
  const archived = useMemo(() => Object.values(pages).filter((p) => p.archived && !p.deletedAt && isResource(p)), [pages]);

  const restore = async (id: string) => {
    try {
      await api.restorePage(id);
      await refresh();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };
  const purge = async (id: string, title: string) => {
    const ok = await confirmDialog({
      title: "Delete permanently?",
      message: `“${title}” and its subpages will be removed from this computer. This cannot be undone.`,
      confirm: "Delete Permanently",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.purgePage(id);
      await refresh();
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Trash</h1>
          <p className="view-sub">Deleted pages stay here until you remove them permanently.</p>
        </div>
      </header>
      {trashed.length === 0 ? (
        <EmptyState icon="delete" title="Trash is empty" text="Pages you delete can be restored from here." />
      ) : (
        <div className="row-list">
          {trashed.map((p) => (
            <div key={p.id} className="list-row">
              <PageIcon icon={p.icon} size={16} />
              <span className="list-row-title bidi">{pageTitle(p)}</span>
              <span className="list-row-sub">Deleted {relTime(p.deletedAt)}</span>
              <button className="chip-btn" onClick={() => restore(p.id)}>
                <Icon name="restore" size={13} />
                Restore
              </button>
              <button className="chip-btn is-danger" onClick={() => purge(p.id, pageTitle(p))}>Delete permanently</button>
            </div>
          ))}
        </div>
      )}

      <h2 className="section-label section-gap">Archived</h2>
      {archived.length === 0 ? (
        <EmptyState compact icon="archive" title="Nothing archived" text="Archived pages leave the sidebar but stay searchable." />
      ) : (
        <div className="row-list">
          {archived.map((p) => (
            <div key={p.id} className="list-row">
              <PageIcon icon={p.icon} size={16} />
              <button className="list-row-title bidi as-link" onClick={() => useStore.getState().openPage(p.id)}>{pageTitle(p)}</button>
              <span className="list-row-sub">Edited {relTime(p.updatedAt)}</span>
              <button className="chip-btn" onClick={async () => { await api.updatePage(p.id, { archived: false }); refresh(); }}>
                <Icon name="unarchive" size={13} />
                Unarchive
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
