/**
 * Items sent between workspaces (docs/PACKS.md, Design 3). A teacher sends
 * an assessment to everyone holding the student role in the Teacher pack;
 * the sync server puts a copy in each student's inbox, and each student's
 * Worlds turns it into an assignment in their own Study pack, linked to the
 * source so a later change (a new date) updates it. Only the fields the
 * definition maps are sent, and the student's own fields (handed in, grade)
 * are never overwritten.
 */
import { useEffect } from "react";
import { useStore } from "../state/store";
import type { Notice } from "../sync/manager";
import { onNotices, publishToMembers } from "../sync/manager";
import { localStore } from "../sync/session";
import type { KindDef, PackDef } from "./definition";
import { createPackItem, itemData, updatePackItem } from "./items";
import { setPackEnabled } from "./packs";
import { enabledPacks, PACK_DEFS, packDef } from "./registry";
import type { PageMeta } from "../lib/types";

/** Settings key: the version of each published item already applied here. */
export const PUBLISHED_KEY = "packs.published";
/** The field a received item keeps its source in. */
export const SOURCE_FIELD = "publishedFrom";

export function targetOf(target: string): { pack: PackDef; kind: KindDef } | null {
  const [p, k] = target.split(".");
  const pack = packDef(p);
  const kind = pack?.kinds.find((x) => x.id === k);
  return pack && kind ? { pack, kind } : null;
}

/** What is sent for an item: its title and the mapped fields only. */
export function publishBody(pack: PackDef, kind: KindDef, page: Pick<PageMeta, "title" | "data">, fromName: string) {
  const p = kind.publish!;
  const data = itemData(page);
  const fields: Record<string, unknown> = {};
  for (const [to, from] of Object.entries(p.fields)) if (data[from] !== undefined && data[from] !== null && data[from] !== "") fields[to] = data[from];
  return { packId: pack.id, roleId: p.role, source: `${pack.id}.${kind.id}`, target: p.target, title: page.title, fields, fromName };
}

export interface ImportStep {
  notice: Notice;
  pack: PackDef;
  kind: KindDef;
  /** The item made earlier from this notice, to update. */
  existing: PageMeta | null;
  fields: Record<string, unknown>;
}

/** Which received items to make or update now. Pure, so it is tested without the app. */
export function planImport(notices: Notice[], pages: Record<string, PageMeta>, applied: Record<string, number>): ImportStep[] {
  const out: ImportStep[] = [];
  for (const n of notices) {
    if (n.kind !== "published" || !n.item || (applied[n.id] ?? 0) >= n.createdAt) continue;
    const t = targetOf(n.item.target);
    if (!t) continue;
    // Only fields the target kind has, so a sender cannot write anything else.
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n.item.fields ?? {})) if (t.kind.fields.some((f) => f.id === k)) fields[k] = v;
    if (n.fromName && t.kind.fields.some((f) => f.id === "teacher")) fields.teacher = n.fromName;
    const existing = Object.values(pages).find((p) => !p.deletedAt && itemData(p)[SOURCE_FIELD] === n.id) ?? null;
    out.push({ notice: n, pack: t.pack, kind: t.kind, existing, fields });
  }
  return out;
}

/** Make or update this device's copies of what was sent to its person. */
export async function importPublished(notices: Notice[]): Promise<number> {
  const s = useStore.getState();
  const applied = { ...((s.settings[PUBLISHED_KEY] ?? {}) as Record<string, number>) };
  const steps = planImport(notices, s.pages, applied);
  let done = 0;
  for (const st of steps) {
    // A student who gets an assignment gets the Study pack with it.
    if (!enabledPacks(useStore.getState().settings).has(st.pack.id)) setPackEnabled(st.pack.id, true);
    const ok = st.existing
      ? (await updatePackItem(st.existing, st.fields), true)
      : !!(await createPackItem(st.pack, st.kind, { title: st.notice.item!.title, data: { ...st.fields, [SOURCE_FIELD]: st.notice.id }, open: false }));
    if (ok) {
      applied[st.notice.id] = st.notice.createdAt;
      done++;
    }
  }
  if (done) useStore.getState().setSetting(PUBLISHED_KEY, applied);
  return done;
}

/** Send a shared item to the members holding the kind's role. Returns how many received it. */
export async function sendItem(page: PageMeta): Promise<{ sent: number } | { error: string }> {
  const def = PACK_DEFS.flatMap((pack) => pack.kinds.map((kind) => ({ pack, kind }))).find(
    ({ pack, kind }) => (kind.kind ?? `${pack.id}.${kind.id}`) === page.kind,
  );
  if (!def?.kind.publish) return { error: "This item cannot be sent." };
  const mode = await localStore()
    .pageMode(page.id)
    .catch(() => null);
  if (!mode?.shared || !mode.workspaceId) return { error: "Share this item with your team workspace first." };
  const name = useStore.getState().profile?.displayName ?? "";
  return publishToMembers(mode.workspaceId, page.id, publishBody(def.pack, def.kind, page, name));
}

/** Received items become the person's own while Worlds is open. */
export function usePublishedImport(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    return onNotices((items) => void importPublished(items));
  }, [ready]);
}
