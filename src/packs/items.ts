/**
 * Pack items: create, read and change them. A pack kind's fields live in the
 * page's metadata under its data key (`item` for new packs, the kind itself for
 * Study) and ride on every page row as `data`, so lists never open each item.
 */
import { api, errorMessage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { defaultIcon } from "../resources/kinds";
import { useStore, type OpenWhere } from "../state/store";
import { dataKeyOf, storedKind, type KindDef, type PackDef } from "./definition";
import { applyComputed, initialData, type ItemData } from "./fields";
import { kindDefOf } from "./registry";

function fail(e: unknown) {
  useStore.getState().toast({ message: errorMessage(e), tone: "error" });
}

/** An item's fields (an empty object when it has none yet). */
export function itemData(p: Pick<PageMeta, "data"> | undefined | null): ItemData {
  const d = p?.data;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as ItemData) : {};
}

/** Live items of one pack kind, not trashed or archived. */
export function itemsOf(pages: Record<string, PageMeta>, kind: string): PageMeta[] {
  return Object.values(pages).filter((p) => p.kind === kind && !p.deletedAt && !p.archived);
}

export async function createPackItem(
  pack: PackDef,
  kind: KindDef,
  opts: { title?: string; data?: ItemData; parentId?: string | null; open?: OpenWhere | false } = {},
): Promise<PageMeta | null> {
  const stored = storedKind(pack, kind);
  const data = applyComputed(kind, { ...initialData(kind), ...opts.data });
  try {
    const meta = await api.createPage({
      kind: stored,
      title: opts.title ?? "",
      icon: defaultIcon(stored),
      parentId: opts.parentId ?? null,
      metadata: { [dataKeyOf(kind)]: data },
    });
    const s = useStore.getState();
    // The row as created carries no data yet in every backend; keep what was sent.
    const withData = { ...meta, data: meta.data ?? data };
    s.patchPageLocal(withData);
    if (opts.open) s.openPage(meta.id, opts.open);
    return withData;
  } catch (e) {
    fail(e);
    return null;
  }
}

/** Merge a patch into an item's fields. The page map updates at once and rolls back if saving fails. */
export async function updatePackItem(p: PageMeta, patch: ItemData): Promise<void> {
  const def = kindDefOf(p.kind);
  if (!def) return;
  const key = def.dataKey;
  const next = applyComputed(def.kind, { ...itemData(p), ...patch }, Object.keys(patch));
  const s = useStore.getState();
  s.patchPageLocal({ ...(s.pages[p.id] ?? p), data: next, updatedAt: Date.now() });
  try {
    const meta = await api.setPageMeta(p.id, key as Parameters<typeof api.setPageMeta>[1], next);
    useStore.getState().patchPageLocal({ ...meta, data: meta.data ?? next });
  } catch (e) {
    s.patchPageLocal(p);
    fail(e);
  }
}
