/** Creating and changing planning items. Writes go through the same store as every resource. */
import { api, errorMessage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { defaultIcon } from "../resources/kinds";
import { useStore, type OpenWhere } from "../state/store";
import { dataOf, nextRepeat, relDay, type DataByKind, type DataKind } from "./model";

const fail = (e: unknown) => useStore.getState().toast({ message: errorMessage(e), tone: "error" });

export const newStepId = () => `s${Math.random().toString(36).slice(2, 9)}`;

/** Create an item. It opens only when `open` says where. */
export async function createItem<K extends DataKind>(
  kind: K,
  opts: { title?: string; data?: DataByKind[K]; parentId?: string | null; open?: OpenWhere | false } = {},
): Promise<PageMeta | null> {
  try {
    const meta = await api.createPage({
      kind,
      title: opts.title ?? "",
      icon: defaultIcon(kind),
      parentId: opts.parentId ?? null,
      metadata: { [kind]: opts.data ?? {} },
    });
    const s = useStore.getState();
    // The row as created carries no data yet in every backend; keep what was sent.
    const withData = { ...meta, data: meta.data ?? opts.data ?? {} };
    s.patchPageLocal(withData);
    if (opts.open) s.openPage(meta.id, opts.open);
    return withData;
  } catch (e) {
    fail(e);
    return null;
  }
}

/** Merge a patch into an item's data. The page map updates right away. */
export async function updateData<K extends DataKind>(p: PageMeta, kind: K, patch: Partial<DataByKind[K]>): Promise<void> {
  const next = { ...dataOf(p, kind), ...patch };
  const s = useStore.getState();
  s.patchPageLocal({ ...(s.pages[p.id] ?? p), data: next, updatedAt: Date.now() });
  try {
    const meta = await api.setPageMeta(p.id, kind, next);
    useStore.getState().patchPageLocal({ ...meta, data: meta.data ?? next });
  } catch (e) {
    s.patchPageLocal(p);
    fail(e);
  }
}

export async function renameItem(p: PageMeta, title: string) {
  if (title === p.title) return;
  try {
    useStore.getState().patchPageLocal(await api.updatePage(p.id, { title }));
  } catch (e) {
    fail(e);
  }
}

/**
 * Tick a task. A repeating task moves to its next date instead of being
 * marked done, so it never has to be recreated.
 */
export async function toggleTask(p: PageMeta) {
  const d = dataOf(p, "task");
  if (!d.done && d.repeat && d.due) {
    const due = nextRepeat(d.due, d.repeat);
    await updateData(p, "task", { due, steps: (d.steps ?? []).map((s) => ({ ...s, done: false })) });
    useStore.getState().toast({ message: `Next: ${relDay(due)}`, tone: "success" });
    return;
  }
  await updateData(p, "task", { done: !d.done, doneAt: d.done ? null : Date.now() });
}

export async function trashItem(p: PageMeta) {
  try {
    await api.deletePage(p.id);
    const s = useStore.getState();
    s.patchPageLocal({ ...p, deletedAt: Date.now() });
    s.toast({
      message: `Moved “${p.title || "item"}” to Trash`,
      action: {
        label: "Undo",
        run: async () => {
          await api.restorePage(p.id);
          await useStore.getState().refreshPages();
        },
      },
    });
  } catch (e) {
    fail(e);
  }
}

/** Turn an inbox capture into something else, keeping its words as the title. */
export async function convertCapture<K extends DataKind>(p: PageMeta, kind: K, data?: DataByKind[K], parentId: string | null = null) {
  const made = await createItem(kind, { title: p.title, data, parentId, open: false });
  if (!made) return null;
  try {
    await api.deletePage(p.id);
    await api.purgePage(p.id);
    const pages = { ...useStore.getState().pages };
    delete pages[p.id];
    useStore.setState({ pages });
  } catch (e) {
    fail(e);
  }
  return made;
}

/** Move an item under a project or subject (or to the top level). */
export async function moveItem(p: PageMeta, parentId: string | null) {
  try {
    useStore.getState().patchPageLocal({ ...(await api.movePage(p.id, parentId, null)), data: p.data });
  } catch (e) {
    fail(e);
  }
}
