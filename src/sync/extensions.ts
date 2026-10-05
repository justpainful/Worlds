/**
 * Editor extensions for shared pages: Tiptap's Collaboration (the Yjs
 * binding) and CollaborationCaret (live cursors and selections), plus
 * comment highlights and a guard that keeps read-only access read-only.
 */
import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { type Anchor, listThreads } from "./comments";
import { FRAGMENT } from "./mirror";
import type { CollabSession } from "./session";
import { useCommentsUi } from "./ui/commentsUi";

export const commentsKey = new PluginKey<DecorationSet>("worldsComments");

function caret(user: Record<string, unknown>): HTMLElement {
  const color = String(user.color ?? "#64a8ff");
  const el = document.createElement("span");
  el.className = "collab-caret";
  el.style.setProperty("--caret", color);
  const label = document.createElement("span");
  label.className = "collab-caret-label";
  label.textContent = String(user.name ?? "Someone");
  el.appendChild(label);
  return el;
}

function anchorRange(state: EditorState, anchor: Anchor | null): { from: number; to: number } | null {
  const ys = ySyncPluginKey.getState(state) as { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Map<unknown, unknown> } | null } | undefined;
  if (!ys?.binding || !anchor) return null;
  try {
    const from = relativePositionToAbsolutePosition(ys.doc, ys.type, Y.createRelativePositionFromJSON(anchor.start), ys.binding.mapping as never);
    const to = relativePositionToAbsolutePosition(ys.doc, ys.type, Y.createRelativePositionFromJSON(anchor.end), ys.binding.mapping as never);
    if (from === null || to === null || to <= from) return null;
    return { from, to };
  } catch {
    return null;
  }
}

/** The current selection as a comment anchor (Yjs relative positions). */
export function selectionAnchor(editor: Editor): { anchor: Anchor; quote: string } | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const ys = ySyncPluginKey.getState(editor.state) as { type: Y.XmlFragment; binding: { mapping: Map<unknown, unknown> } | null } | undefined;
  if (!ys?.binding) return null;
  const start = absolutePositionToRelativePosition(from, ys.type, ys.binding.mapping as never);
  const end = absolutePositionToRelativePosition(to, ys.type, ys.binding.mapping as never);
  return {
    anchor: { start: Y.relativePositionToJSON(start), end: Y.relativePositionToJSON(end) },
    quote: editor.state.doc.textBetween(from, to, " ").slice(0, 280),
  };
}

/** Where a thread's anchor currently sits in the editor, if anywhere. */
export function threadRange(editor: Editor, anchor: Anchor | null) {
  return anchorRange(editor.state, anchor);
}

function CommentHighlights(session: CollabSession) {
  return Extension.create({
    name: "worldsCommentHighlights",
    addProseMirrorPlugins() {
      const build = (state: EditorState): DecorationSet => {
        const active = useCommentsUi.getState().active;
        const decos: Decoration[] = [];
        for (const t of listThreads(session.comments)) {
          if (t.resolved) continue;
          const r = anchorRange(state, t.anchor);
          if (!r) continue;
          decos.push(Decoration.inline(r.from, r.to, { class: `comment-anchor${t.id === active ? " is-active" : ""}`, "data-thread": t.id }));
        }
        return DecorationSet.create(state.doc, decos);
      };
      return [
        new Plugin<DecorationSet>({
          key: commentsKey,
          state: {
            init: () => DecorationSet.empty,
            apply: (tr, old, _prev, next) => (tr.docChanged || tr.getMeta(commentsKey) || tr.getMeta(ySyncPluginKey) ? build(next) : old),
          },
          props: {
            decorations: (state) => commentsKey.getState(state),
            handleClick: (_view, _pos, event) => {
              const el = (event.target as HTMLElement | null)?.closest?.("[data-thread]") as HTMLElement | null;
              if (!el?.dataset.thread) return false;
              useCommentsUi.getState().openThread(session.pageId, el.dataset.thread);
              return false;
            },
          },
          view: (view) => {
            const refresh = () => {
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(commentsKey, true));
            };
            const later = () => queueMicrotask(refresh);
            session.comments.on("update", later);
            const unsub = useCommentsUi.subscribe((s, p) => s.active !== p.active && later());
            later();
            return {
              destroy: () => {
                session.comments.off("update", later);
                unsub();
              },
            };
          },
        }),
      ];
    },
  });
}

/** Refuse local document changes when the user may not edit. */
function ReadOnlyGuard(canEdit: () => boolean) {
  return Extension.create({
    name: "worldsReadOnlyGuard",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction: (tr) => {
            if (!tr.docChanged || canEdit()) return true;
            const meta = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
            return !!meta?.isChangeOrigin;
          },
        }),
      ];
    },
  });
}

export function collabExtensions(session: CollabSession): AnyExtension[] {
  const user = session.user;
  return [
    Collaboration.configure({ document: session.content, field: FRAGMENT }),
    CollaborationCaret.configure({
      // Presence belongs to the session, so it survives provider restarts.
      provider: { awareness: session.awareness },
      user: { id: user.id, name: user.name, color: user.color },
      render: caret,
      selectionRender: (u: Record<string, unknown>) => ({
        nodeName: "span",
        class: "collab-selection",
        style: `--caret: ${String(u.color ?? "#64a8ff")}`,
      }),
    }),
    CommentHighlights(session),
    ReadOnlyGuard(() => session.canEdit),
  ];
}
