/**
 * Team sync for a pack item's fields while its page is open (docs/PACKS.md,
 * Design 1 and 2). Personal items do nothing here. For a shared item:
 *
 * - the page's content document carries a `fields` map with the fields every
 *   role may see;
 * - fields some role must not see go in a second document,
 *   `<pageId>__hidden__<pack>`, which the server does not open for members
 *   whose role in that pack is restricted, so those fields never reach them.
 *
 * Changes others make arrive in the maps and are saved as the item's fields;
 * changes made here (in a view, by Claude, by an automation) reach the item's
 * fields first and are pushed into the maps, so every path ends the same way.
 */
import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { markKind, pushFields, readFields, watchFields } from "../sync/fields";
import { MemoryLocalStore } from "../sync/localStore";
import { startSyncManager, workspaceFor } from "../sync/manager";
import { acquireSession, localStore, releaseSession, type CollabSession } from "../sync/session";
import { useSessionReady } from "../sync/ui/hooks";
import { combineFields, hiddenDocId, hiddenKeys, splitFields } from "./hidden";
import { itemData, replaceItemFields } from "./items";
import { kindDefOf } from "./registry";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function useItemSync(pageId: string) {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [hidden, setHidden] = useState<CollabSession | null>(null);
  const { ready, generation } = useSessionReady(session);

  useEffect(() => startSyncManager(), []);

  // Only a shared page has documents to sync with.
  useEffect(() => {
    let alive = true;
    const held: CollabSession[] = [];
    void localStore()
      .pageMode(pageId)
      .then((m) => {
        if (!alive || !m.shared) return;
        const ws = workspaceFor({ workspaceId: m.workspaceId });
        const main = acquireSession(pageId, ws);
        held.push(main);
        setSession(main);
        const def = kindDefOf(useStore.getState().pages[pageId]?.kind ?? "");
        if (def && hiddenKeys(def.pack).size) {
          // Not kept in the local replica: the fields are already saved on the item itself.
          const h = acquireSession(hiddenDocId(pageId, def.pack.id), ws, { store: new MemoryLocalStore() });
          held.push(h);
          setHidden(h);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      setSession(null);
      setHidden(null);
      for (const s of held) releaseSession(s);
    };
  }, [pageId]);

  useEffect(() => {
    if (!session || !ready) return;
    const doc = session.content;
    const def = kindDefOf(useStore.getState().pages[pageId]?.kind ?? "");
    const keys = def ? hiddenKeys(def.pack) : new Set<string>();
    // The hidden document counts only once the server has let this device in.
    const hiddenOpen = () => !!hidden && hidden.ready && hidden.info.state === "synced";

    const adopt = () => {
      const page = useStore.getState().pages[pageId];
      if (!page) return;
      const next = combineFields(readFields(doc), hiddenOpen() ? readFields(hidden!.content) : null, itemData(page), keys);
      if (!same(itemData(page), next)) void replaceItemFields(page, next);
    };
    const push = () => {
      const page = useStore.getState().pages[pageId];
      if (!page) return;
      const { open, hidden: secret } = splitFields(itemData(page), keys);
      if (session.canEdit) {
        markKind(doc, page.kind);
        pushFields(doc, open);
      }
      if (hiddenOpen() && hidden!.canEdit) pushFields(hidden!.content, secret);
    };

    // The documents win when they already have fields; a first open seeds them from this device.
    if (Object.keys(readFields(doc)).length) adopt();
    else push();

    const stops = [watchFields(doc, adopt)];
    if (hidden) {
      let watched: (() => void) | null = null;
      const onHidden = () => {
        if (!hiddenOpen() || watched) return;
        watched = watchFields(hidden.content, adopt);
        if (Object.keys(readFields(hidden.content)).length) adopt();
        else push();
      };
      stops.push(hidden.subscribe(onHidden));
      stops.push(() => watched?.());
      onHidden();
    }
    stops.push(
      useStore.subscribe((state, prev) => {
        const now = state.pages[pageId];
        if (now && now.data !== prev.pages[pageId]?.data) push();
      }),
    );
    return () => stops.forEach((s) => s());
  }, [session, hidden, ready, generation, pageId]);
}
