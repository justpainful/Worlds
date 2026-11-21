/**
 * Comments on the text. A comment mark ties a stretch of text to a thread
 * kept in the page's metadata (`comments`), so threads survive edits and
 * travel with the page. Click the marked text to read, reply or resolve.
 */
import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { tr, uiLanguage } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { relTime } from "../ui/misc";

export interface CommentMessage {
  id: string;
  author: string;
  text: string;
  at: number;
}

export interface CommentThread {
  quote: string;
  resolved: boolean;
  messages: CommentMessage[];
}

export type Threads = Record<string, CommentThread>;

/** A page's comment threads, read fresh from its metadata. */
export async function loadThreads(pageId: string): Promise<Threads> {
  const page = await api.page(pageId);
  const c = page?.metadata?.comments;
  return c && typeof c === "object" ? (c as Threads) : {};
}

async function saveThreads(pageId: string, threads: Threads) {
  const meta = await api.setPageMeta(pageId, "comments", threads);
  useStore.getState().patchPageLocal(meta);
}

const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const me = () => useStore.getState().profile?.displayName || tr("You");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      setComment: (threadId: string) => ReturnType;
      unsetComment: (threadId: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<{ onOpen: (threadId: string, el: HTMLElement) => void }>({
  name: "comment",
  inclusive: false,
  excludes: "",
  addOptions() {
    return { onOpen: () => undefined };
  },
  addAttributes() {
    return { threadId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-comment]", getAttrs: (el) => ({ threadId: (el as HTMLElement).getAttribute("data-comment") }) }];
  },
  renderHTML({ HTMLAttributes, mark }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-comment": mark.attrs.threadId, class: "comment-mark" }), 0];
  },
  addCommands() {
    return {
      setComment:
        (threadId) =>
        ({ commands }) =>
          commands.setMark(this.name, { threadId }),
      unsetComment:
        (threadId) =>
        ({ tr: t, state, dispatch }) => {
          const type = state.schema.marks.comment;
          state.doc.descendants((node, pos) => {
            if (node.marks.some((m) => m.type === type && m.attrs.threadId === threadId)) t.removeMark(pos, pos + node.nodeSize, type);
          });
          if (dispatch) dispatch(t);
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    const open = this.options.onOpen;
    return [
      new Plugin({
        key: new PluginKey("commentClick"),
        props: {
          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement).closest<HTMLElement>("span[data-comment]");
            const id = el?.getAttribute("data-comment");
            if (!el || !id) return false;
            open(id, el);
            return false;
          },
        },
      }),
    ];
  },
});

function ThreadPanel({ pageId, threadId, rect, quote, close, editor }: { pageId: string; threadId: string; rect: DOMRect; quote: string; close: () => void; editor: Editor }) {
  const [threads, setThreads] = useState<Threads>({});
  useEffect(() => {
    loadThreads(pageId).then(setThreads, () => undefined);
  }, [pageId]);
  const thread = threads[threadId] ?? { quote, resolved: false, messages: [] };
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [close]);

  const write = async (next: Threads) => {
    setBusy(true);
    try {
      await saveThreads(pageId, next);
      setThreads(next);
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    const msg: CommentMessage = { id: uid(), author: me(), text: t, at: Date.now() };
    await write({ ...threads, [threadId]: { ...thread, quote: thread.quote || quote, messages: [...thread.messages, msg] } });
  };

  const remove = async () => {
    const next = { ...threads };
    delete next[threadId];
    editor.commands.unsetComment(threadId);
    await write(next);
    close();
  };

  const width = Math.min(340, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const top = Math.min(rect.bottom + 8, window.innerHeight - 260);

  return (
    <div className="comment-thread" ref={box} style={{ left, top, width }} dir={uiLanguage() === "ar" ? "rtl" : "ltr"} role="dialog" aria-label={tr("Comment")}>
      <div className="ct-quote bidi" dir="auto">
        {thread.quote || quote}
      </div>
      {thread.messages.map((m) => (
        <div key={m.id} className="ct-msg">
          <div className="ct-meta">
            <span className="ct-author">{m.author}</span>
            <span className="ct-time">{relTime(m.at)}</span>
          </div>
          <div className="ct-text bidi" dir="auto">
            {m.text}
          </div>
        </div>
      ))}
      <form
        className="ct-reply"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="field bidi"
          dir="auto"
          autoFocus
          rows={2}
          value={text}
          placeholder={thread.messages.length ? tr("Reply") : tr("Add a comment")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="ct-actions">
          {thread.messages.length > 0 && (
            <>
              <button type="button" className="btn btn-plain btn-compact" disabled={busy} onClick={() => write({ ...threads, [threadId]: { ...thread, resolved: !thread.resolved } })}>
                <Icon name="check" size={13} />
                {thread.resolved ? tr("Reopen") : tr("Resolve")}
              </button>
              <button type="button" className="icon-btn" aria-label={tr("Delete comment")} data-tip={tr("Delete comment")} disabled={busy} onClick={remove}>
                <Icon name="delete" size={14} />
              </button>
            </>
          )}
          <span className="grow" />
          <button type="submit" className="btn btn-tinted btn-compact" disabled={busy || !text.trim()}>
            {thread.messages.length ? tr("Reply") : tr("Comment")}
          </button>
        </div>
      </form>
    </div>
  );
}

let openRoot: { close: () => void } | null = null;

/** Show a comment thread under an element or rectangle. */
export function openCommentThread(editor: Editor, pageId: string, threadId: string, anchor: DOMRect, quote = "") {
  openRoot?.close();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
    if (openRoot?.close === close) openRoot = null;
    // A thread closed with no message leaves no mark behind.
    loadThreads(pageId).then((all) => {
      const t = all[threadId];
      if ((!t || !t.messages.length) && !editor.isDestroyed) editor.commands.unsetComment(threadId);
    }, () => undefined);
  };
  openRoot = { close };
  root.render(<ThreadPanel pageId={pageId} threadId={threadId} rect={anchor} quote={quote} close={close} editor={editor} />);
}

/** Start a comment on the current selection. */
export function commentSelection(editor: Editor, pageId: string) {
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const quote = editor.state.doc.textBetween(from, to, " ").slice(0, 280);
  const threadId = uid();
  editor.chain().focus().setComment(threadId).run();
  const end = editor.view.coordsAtPos(to);
  const start = editor.view.coordsAtPos(from);
  openCommentThread(editor, pageId, threadId, new DOMRect(start.left, start.top, end.right - start.left, end.bottom - start.top), quote);
}
