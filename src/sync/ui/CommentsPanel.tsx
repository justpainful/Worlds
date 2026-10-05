import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Glass } from "../../glass/Glass";
import { LAYER } from "../../glass/materials";
import { IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { relTime } from "../../ui/misc";
import { createThread, deleteComment, reply, setResolved, type Person, type ThreadData } from "../comments";
import { threadRange } from "../extensions";
import type { CollabSession } from "../session";
import { useCommentsUi } from "./commentsUi";
import { useComments } from "./hooks";
import { MentionInput } from "./MentionInput";

const nameOf = (people: Person[], id: string, me: { id: string; name: string }) =>
  id === me.id ? me.name : (people.find((p) => p.id === id)?.name ?? "Someone");

/** Side panel with the page's comment threads, a composer and replies. */
export function CommentsPanel({ session, editor }: { session: CollabSession; editor: Editor | null }) {
  const ui = useCommentsUi();
  const { threads, people } = useComments(session);
  const me = session.user;
  const canComment = session.canComment;
  const listRef = useRef<HTMLDivElement>(null);
  const open = ui.pageId === session.pageId;

  const visible = useMemo(() => threads.filter((t) => ui.showResolved || !t.resolved || t.id === ui.active), [threads, ui.showResolved, ui.active]);
  const resolvedCount = threads.filter((t) => t.resolved).length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement)?.closest?.(".mention-input") && ui.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, ui]);

  useEffect(() => {
    if (!open || !ui.active) return;
    listRef.current?.querySelector(`[data-thread-card="${ui.active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, ui.active]);

  if (!open) return null;

  const reveal = (t: ThreadData) => {
    ui.openThread(session.pageId, t.id);
    const r = editor && !editor.isDestroyed ? threadRange(editor, t.anchor) : null;
    if (!editor || !r) return;
    editor.commands.setTextSelection({ from: r.from, to: r.to });
    editor.view.dom.querySelector(`[data-thread="${t.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return createPortal(
    <Glass material="regular" layer={LAYER.floating} className="comments-panel" radius="var(--r-popover)" role="complementary" aria-label="Comments">
      <header className="cp-head">
        <span className="cp-title">Comments</span>
        <span className="cp-spacer" />
        {resolvedCount > 0 && (
          <button type="button" className={`chip-btn cp-chip ${ui.showResolved ? "is-on" : ""}`} onClick={ui.toggleResolved}>
            {ui.showResolved ? "Hide resolved" : `Resolved ${resolvedCount}`}
          </button>
        )}
        <IconButton icon="close" label="Close comments" onClick={ui.close} />
      </header>

      <div className="cp-list" ref={listRef}>
        {ui.draft && ui.draft.pageId === session.pageId && (
          <div className="cp-card is-draft">
            <blockquote className="cp-quote bidi" dir="auto">{ui.draft.quote}</blockquote>
            <MentionInput
              people={people.filter((p) => p.id !== me.id)}
              placeholder="Add a comment, @ to mention"
              autoFocus
              onSubmit={(body, mentions) => {
                const d = useCommentsUi.getState().draft;
                if (!d) return;
                session.announce();
                const id = createThread(session.comments, me, { anchor: d.anchor, quote: d.quote, body, mentions });
                ui.clearDraft();
                ui.openThread(session.pageId, id);
              }}
            />
            <div className="cp-actions">
              <button type="button" className="cp-link" onClick={ui.clearDraft}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {visible.length === 0 && !ui.draft && (
          <div className="cp-empty">
            <Icon name="dm" size={22} />
            <p>{canComment ? "Select text and choose Comment to start a conversation." : "No comments yet."}</p>
          </div>
        )}

        {visible.map((t) => {
          const active = t.id === ui.active;
          const first = t.comments[0];
          const detached = editor && !editor.isDestroyed && !threadRange(editor, t.anchor);
          return (
            <article
              key={t.id}
              data-thread-card={t.id}
              className={`cp-card ${active ? "is-active" : ""} ${t.resolved ? "is-resolved" : ""}`}
              onClick={() => !active && reveal(t)}
            >
              {t.quote && (
                <blockquote className={`cp-quote bidi ${detached ? "is-detached" : ""}`} dir="auto" title={detached ? "The commented text was removed" : undefined}>
                  {t.quote}
                </blockquote>
              )}
              {t.comments.filter((c) => !c.deleted).map((c) => (
                <div key={c.id} className="cp-comment">
                  <div className="cp-meta">
                    <span className="cp-dot" style={{ background: people.find((p) => p.id === c.author)?.color ?? me.color }} />
                    <span className="cp-author bidi">{nameOf(people, c.author, me)}</span>
                    <span className="cp-time">{relTime(c.createdAt)}</span>
                    {c.author === me.id && canComment && (c !== first || t.comments.length === 1) && (
                      <button
                        type="button"
                        className="cp-link cp-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteComment(session.comments, t.id, c.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="cp-body bidi" dir="auto">
                    {c.body}
                  </p>
                </div>
              ))}
              {t.resolved && <div className="cp-resolved-note">Resolved by {nameOf(people, t.resolvedBy ?? "", me)}</div>}
              {active && canComment && (
                <div className="cp-reply" onClick={(e) => e.stopPropagation()}>
                  {!t.resolved && (
                    <MentionInput
                      people={people.filter((p) => p.id !== me.id)}
                      placeholder="Reply"
                      onSubmit={(body, mentions) => {
                        session.announce();
                        reply(session.comments, me, t.id, body, mentions);
                      }}
                    />
                  )}
                  <div className="cp-actions">
                    <button type="button" className="cp-link" onClick={() => setResolved(session.comments, me, t.id, !t.resolved)}>
                      {t.resolved ? "Reopen" : "Resolve"}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </Glass>,
    document.body,
  );
}
