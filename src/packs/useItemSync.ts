/**
 * Team sync for a pack item's fields while its page is open (docs/PACKS.md,
 * Design 1). Personal items do nothing here. For a shared item, the page's
 * content document carries a `fields` map: changes others make arrive in it
 * and are saved as the item's fields; changes made here (in a view, by
 * Claude, by an automation) reach the item's fields first and are pushed
 * into the map, so every path ends in the same document.
 */
import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { pushFields, readFields, watchFields, type Fields } from "../sync/fields";
import { startSyncManager, workspaceFor } from "../sync/manager";
import { acquireSession, localStore, releaseSession, type CollabSession } from "../sync/session";
import { useSessionReady } from "../sync/ui/hooks";
import { itemData, replaceItemFields } from "./items";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function useItemSync(pageId: string) {
  const [session, setSession] = useState<CollabSession | null>(null);
  const { ready, generation } = useSessionReady(session);

  useEffect(() => startSyncManager(), []);

  // Only a shared page has a document to sync with.
  useEffect(() => {
    let alive = true;
    let held: CollabSession | null = null;
    void localStore()
      .pageMode(pageId)
      .then((m) => {
        if (!alive || !m.shared) return;
        held = acquireSession(pageId, workspaceFor({ workspaceId: m.workspaceId }));
        setSession(held);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (held) {
        setSession(null);
        releaseSession(held);
      }
    };
  }, [pageId]);

  useEffect(() => {
    if (!session || !ready) return;
    const doc = session.content;
    const adopt = (fields: Fields) => {
      const page = useStore.getState().pages[pageId];
      if (page && !same(itemData(page), fields)) void replaceItemFields(page, fields);
    };
    // The document wins when it already has fields; a first open seeds it from this device.
    const start = readFields(doc);
    if (Object.keys(start).length) adopt(start);
    else if (session.canEdit) {
      const page = useStore.getState().pages[pageId];
      if (page) pushFields(doc, itemData(page));
    }
    const stopWatching = watchFields(doc, adopt);
    const stopListening = useStore.subscribe((state, prev) => {
      const now = state.pages[pageId];
      if (!now || now.data === prev.pages[pageId]?.data || !session.canEdit) return;
      pushFields(doc, itemData(now));
    });
    return () => {
      stopWatching();
      stopListening();
    };
  }, [session, ready, generation, pageId]);
}
