/**
 * A shared item's fields in team sync (docs/PACKS.md, Design 1). They live in
 * a `fields` map of the page's content document, next to its blocks, so two
 * people changing different fields of one invoice both keep their change.
 * The map is mirrored into the item's own fields (metadata.item) on each
 * device; these helpers are the pure part, tested with plain Yjs documents.
 */
import * as Y from "yjs";

export type Fields = Record<string, unknown>;

/** Writes made here from the item's own fields, so the mirror does not echo them back. */
export const ORIGIN_FIELDS = "worlds-fields";

export const fieldsMap = (doc: Y.Doc) => doc.getMap<unknown>("fields");

export function readFields(doc: Y.Doc): Fields {
  return fieldsMap(doc).toJSON() as Fields;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What must change in `from` to make it equal `to`: values to set and keys to remove. */
export function fieldsDiff(from: Fields, to: Fields): { set: Fields; remove: string[] } {
  const set: Fields = {};
  for (const [k, v] of Object.entries(to)) if (v !== undefined && !same(from[k], v)) set[k] = v;
  const remove = Object.keys(from).filter((k) => !(k in to) || to[k] === undefined);
  return { set, remove };
}

/** Bring the document's fields to the item's, changing only the keys that differ. Returns whether anything changed. */
export function pushFields(doc: Y.Doc, local: Fields, origin: unknown = ORIGIN_FIELDS): boolean {
  const { set, remove } = fieldsDiff(readFields(doc), local);
  if (!Object.keys(set).length && !remove.length) return false;
  const map = fieldsMap(doc);
  doc.transact(() => {
    for (const [k, v] of Object.entries(set)) map.set(k, v);
    for (const k of remove) map.delete(k);
  }, origin);
  return true;
}

/**
 * Record the item's kind ("shop.order") in the document's `meta` map, once,
 * so a phone opening the shared page knows which pack fields it holds.
 */
export function markKind(doc: Y.Doc, kind: string): boolean {
  const meta = doc.getMap<unknown>("meta");
  if (meta.get("kind") === kind) return false;
  doc.transact(() => meta.set("kind", kind), ORIGIN_FIELDS);
  return true;
}

/** Calls back with the document's fields whenever someone else changes them. */
export function watchFields(doc: Y.Doc, onRemote: (fields: Fields) => void): () => void {
  const map = fieldsMap(doc);
  const handler = (_e: Y.YMapEvent<unknown>, tx: Y.Transaction) => {
    if (tx.origin === ORIGIN_FIELDS) return;
    onRemote(readFields(doc));
  };
  map.observe(handler);
  return () => map.unobserve(handler);
}
