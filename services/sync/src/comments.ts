/**
 * The comments sub-document (channel 1). Layout:
 *
 *   threads: Y.Map<threadId, Y.Map>
 *     id, anchor { start, end } (Yjs relative positions as JSON), quote,
 *     createdBy, createdAt, resolved, resolvedBy, resolvedAt,
 *     comments: Y.Array<Y.Map { id, author, body, mentions[], createdAt, editedAt?, deleted? }>
 *   people: Y.Map<userId, { name, color }>
 *
 * Commenters may only write here, and every writer is held to authorship
 * rules: nobody can post as someone else or edit someone else's words.
 */
import * as Y from "yjs";
import type { AccessLevel } from "./protocol";

export interface CommentJSON {
  id: string;
  author: string;
  body: string;
  mentions?: string[];
  createdAt: number;
  editedAt?: number;
  deleted?: boolean;
}

export interface ThreadJSON {
  id: string;
  anchor?: unknown;
  quote?: string;
  createdBy: string;
  createdAt: number;
  resolved?: boolean;
  resolvedBy?: string | null;
  resolvedAt?: number | null;
  comments?: CommentJSON[];
}

export interface CommentsJSON {
  threads: Record<string, ThreadJSON>;
  people: Record<string, unknown>;
  roots: string[];
}

export function commentsJSON(doc: Y.Doc): CommentsJSON {
  return {
    threads: doc.getMap("threads").toJSON() as Record<string, ThreadJSON>,
    people: doc.getMap("people").toJSON() as Record<string, unknown>,
    roots: [...doc.share.keys()],
  };
}

const THREAD_OPEN_FIELDS = new Set(["resolved", "resolvedBy", "resolvedAt", "comments"]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Check a comments-document change. Returns null when it is allowed, or the
 * reason it is not.
 */
export function validateCommentsChange(before: CommentsJSON, after: CommentsJSON, userId: string, level: AccessLevel): string | null {
  const admin = level === "full";
  for (const root of after.roots) {
    if (root !== "threads" && root !== "people") return `unknown root "${root}"`;
  }
  for (const key of new Set([...Object.keys(before.people), ...Object.keys(after.people)])) {
    if (!same(before.people[key], after.people[key]) && key !== userId) return "people entries are written by their owner";
  }
  const ids = new Set([...Object.keys(before.threads), ...Object.keys(after.threads)]);
  for (const id of ids) {
    const b = before.threads[id];
    const a = after.threads[id];
    if (!b && a) {
      if (a.createdBy !== userId) return "threads are created by their author";
      if ((a.comments ?? []).some((c) => c.author !== userId)) return "comments are written by their author";
      if (a.resolved && a.resolvedBy !== userId) return "resolvedBy must be the resolver";
      continue;
    }
    if (b && !a) {
      const own = b.createdBy === userId && (b.comments ?? []).every((c) => c.author === userId);
      if (!own && !admin) return "only the author or a full-access member can delete a thread";
      continue;
    }
    if (!a || !b) continue;
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (THREAD_OPEN_FIELDS.has(field)) continue;
      if (!same((a as unknown as Record<string, unknown>)[field], (b as unknown as Record<string, unknown>)[field]) && b.createdBy !== userId && !admin) {
        return `only the thread author can change "${field}"`;
      }
    }
    if (a.resolvedBy !== b.resolvedBy && a.resolvedBy && a.resolvedBy !== userId) {
      return "resolvedBy must be the resolver";
    }
    const bc = new Map((b.comments ?? []).map((c) => [c.id, c]));
    const ac = new Map((a.comments ?? []).map((c) => [c.id, c]));
    for (const cid of new Set([...bc.keys(), ...ac.keys()])) {
      const x = bc.get(cid);
      const y = ac.get(cid);
      if (!x && y && y.author !== userId) return "comments are written by their author";
      if (x && !y && x.author !== userId && !admin) return "only the author or a full-access member can delete a comment";
      if (x && y && !same(x, y)) {
        if (x.author !== y.author) return "comment authorship cannot change";
        if (x.author !== userId && !admin) return "only the author can edit a comment";
      }
    }
  }
  return null;
}

export interface AddedComment {
  threadId: string;
  comment: CommentJSON;
  /** Everyone else who wrote in the thread before, for reply notifications. */
  participants: string[];
}

export function addedComments(before: CommentsJSON, after: CommentsJSON): AddedComment[] {
  const out: AddedComment[] = [];
  for (const [id, t] of Object.entries(after.threads)) {
    const prev = new Set((before.threads[id]?.comments ?? []).map((c) => c.id));
    const participants = new Set<string>();
    if (before.threads[id]) {
      participants.add(before.threads[id].createdBy);
      for (const c of before.threads[id].comments ?? []) participants.add(c.author);
    }
    for (const c of t.comments ?? []) {
      if (!prev.has(c.id) && !c.deleted) out.push({ threadId: id, comment: c, participants: [...participants].filter((p) => p !== c.author) });
    }
  }
  return out;
}
