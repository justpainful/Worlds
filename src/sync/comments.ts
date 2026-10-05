/**
 * Comments live in the page's comments sub-document (channel 1), so people
 * with comment access can discuss a page they cannot edit. Layout and rules
 * match services/sync/src/comments.ts.
 */
import * as Y from "yjs";
import { newBlockId } from "../editor/extensions/blockIds";
import type { SyncUser } from "./config";

export interface CommentData {
  id: string;
  author: string;
  body: string;
  mentions: string[];
  createdAt: number;
  editedAt?: number;
  deleted?: boolean;
}

export interface Anchor {
  /** Yjs relative positions (JSON) in the content document. */
  start: unknown;
  end: unknown;
}

export interface ThreadData {
  id: string;
  anchor: Anchor | null;
  quote: string;
  createdBy: string;
  createdAt: number;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: number | null;
  comments: CommentData[];
}

export interface Person {
  id: string;
  name: string;
  color: string;
}

const threadsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("threads");
const peopleOf = (doc: Y.Doc) => doc.getMap<{ name: string; color: string }>("people");

export function listThreads(doc: Y.Doc): ThreadData[] {
  const out: ThreadData[] = [];
  threadsOf(doc).forEach((t, id) => {
    const j = t.toJSON() as Partial<ThreadData>;
    out.push({
      id,
      anchor: (j.anchor as Anchor) ?? null,
      quote: j.quote ?? "",
      createdBy: j.createdBy ?? "",
      createdAt: j.createdAt ?? 0,
      resolved: !!j.resolved,
      resolvedBy: j.resolvedBy ?? null,
      resolvedAt: j.resolvedAt ?? null,
      comments: (j.comments ?? []).map((c) => ({ ...c, mentions: c.mentions ?? [] })),
    });
  });
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function listPeople(doc: Y.Doc): Person[] {
  return [...peopleOf(doc).entries()].map(([id, p]) => ({ id, name: p.name, color: p.color }));
}

/** Record the user's display name for mentions (own entry only). */
export function upsertPerson(doc: Y.Doc, user: SyncUser) {
  const cur = peopleOf(doc).get(user.id);
  if (cur && cur.name === user.name && cur.color === user.color) return;
  peopleOf(doc).set(user.id, { name: user.name, color: user.color });
}

function commentMap(user: SyncUser, body: string, mentions: string[]): Y.Map<unknown> {
  return new Y.Map<unknown>([
    ["id", newBlockId()],
    ["author", user.id],
    ["body", body],
    ["mentions", [...new Set(mentions)]],
    ["createdAt", Date.now()],
  ]);
}

export function createThread(doc: Y.Doc, user: SyncUser, input: { anchor: Anchor | null; quote: string; body: string; mentions: string[] }): string {
  const id = newBlockId();
  doc.transact(() => {
    const comments = new Y.Array<Y.Map<unknown>>();
    comments.push([commentMap(user, input.body, input.mentions)]);
    threadsOf(doc).set(
      id,
      new Y.Map<unknown>([
        ["id", id],
        ["anchor", input.anchor],
        ["quote", input.quote.slice(0, 280)],
        ["createdBy", user.id],
        ["createdAt", Date.now()],
        ["resolved", false],
        ["comments", comments],
      ]),
    );
  });
  return id;
}

export function reply(doc: Y.Doc, user: SyncUser, threadId: string, body: string, mentions: string[]) {
  const t = threadsOf(doc).get(threadId);
  const list = t?.get("comments") as Y.Array<Y.Map<unknown>> | undefined;
  if (!list) return;
  list.push([commentMap(user, body, mentions)]);
}

export function setResolved(doc: Y.Doc, user: SyncUser, threadId: string, resolved: boolean) {
  const t = threadsOf(doc).get(threadId);
  if (!t) return;
  doc.transact(() => {
    t.set("resolved", resolved);
    t.set("resolvedBy", resolved ? user.id : null);
    t.set("resolvedAt", resolved ? Date.now() : null);
  });
}

/** Remove one's own comment; the first comment removes the whole thread. */
export function deleteComment(doc: Y.Doc, threadId: string, commentId: string) {
  const t = threadsOf(doc).get(threadId);
  const list = t?.get("comments") as Y.Array<Y.Map<unknown>> | undefined;
  if (!t || !list) return;
  const idx = list.toArray().findIndex((c) => c.get("id") === commentId);
  if (idx < 0) return;
  if (idx === 0 && list.length === 1) threadsOf(doc).delete(threadId);
  else list.delete(idx, 1);
}

/** Mention ids in a comment body written with "@Name" for known people. */
export function mentionsIn(body: string, people: Person[]): string[] {
  const ids: string[] = [];
  for (const p of people) {
    if (p.name && body.includes(`@${p.name}`)) ids.push(p.id);
  }
  return ids;
}
