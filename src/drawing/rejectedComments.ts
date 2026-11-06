import * as Y from "yjs";
import { listThreads } from "../sync/comments";
import { validDrawingAnchor, type DrawingCommentAnchor } from "./collaborationTypes";
export interface RejectedComment { threadId: string; commentId: string; body: string; createdAt: number; resolved: boolean; anchor: DrawingCommentAnchor }
/** Read only the current owner's text from a complete causal snapshot. The
 * archive is never applied to the live document or retransmitted as a CRDT. */
export function rejectedComments(bytes: Uint8Array, owner: string): RejectedComment[] {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("The refused-comment archive exceeds its size limit");
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bytes);
    return listThreads(doc).flatMap((thread) => validDrawingAnchor(thread.anchor) ? thread.comments.filter((c) => c.author === owner && !c.deleted && !!c.body.trim()).map((c) => ({ threadId: thread.id, commentId: c.id, body: c.body, createdAt: Number.isFinite(c.createdAt) && Math.abs(c.createdAt) <= 8.64e15 ? c.createdAt : 0, resolved: thread.resolved, anchor: thread.anchor as DrawingCommentAnchor })) : []);
  } finally { doc.destroy(); }
}
export function rejectedCommentsText(comments: RejectedComment[], arabic: boolean): string {
  return `${arabic ? "تعليقاتي في النسخة المحلية المرفوضة" : "My comments in the refused local copy"}\n\n${comments.map((c) => `${new Date(c.createdAt).toISOString()}\n${c.body}`).join("\n\n")}\n`;
}
