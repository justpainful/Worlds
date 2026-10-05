import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchField } from "../../ui/SearchField";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, isTauri } from "../../lib/api";
import type { AiChat, ChatAttachment } from "../../lib/types";
import { useStore, pageTitle } from "../../state/store";
import { Icon } from "../../ui/Icon";
import { menuAt, Popover } from "../../ui/Menu";
import { PageIcon, relTime, Spinner } from "../../ui/misc";
import { Glass } from "../../glass/Glass";
import { MentionMenu, type MentionPick, type ToolRef } from "../mentions";
import { ProductIcon } from "../../ui/ProductIcon";
import { LAYER } from "../../glass/materials";
import { uploadFiles, uploadPaths } from "./uploads";
import { AttachmentStrip, ModelButton } from "./messages";
import { isResource } from "../../resources/kinds";

// ---------------------------------------------------------------------------
// Composer: text, page context, #conversation references
// ---------------------------------------------------------------------------

/** Unsent text per conversation, so closing the panel never loses a draft. */
export const draftKey = (chatId: string | null) => `worlds.ai.draft.${chatId ?? "new"}`;
export function readDraft(chatId: string | null): string {
  try {
    return localStorage.getItem(draftKey(chatId)) ?? "";
  } catch {
    return "";
  }
}
export function writeDraft(chatId: string | null, text: string) {
  try {
    if (text.trim()) localStorage.setItem(draftKey(chatId), text);
    else localStorage.removeItem(draftKey(chatId));
  } catch {
    /* storage unavailable: drafts are a convenience */
  }
}

export interface ChatRef {
  id: string;
  title: string;
}

export function Composer({
  busy,
  pageId,
  onPageId,
  onSend,
  onStop,
  hasMessages,
  initialPrompt = "",
  autoFocusKey,
  currentChatId,
  onEscape,
  prefill,
  size = "panel",
}: {
  busy: boolean;
  pageId: string | null;
  onPageId: (id: string | null) => void;
  onSend: (prompt: string, attachments: ChatAttachment[]) => void;
  onStop: () => void;
  hasMessages: boolean;
  initialPrompt?: string;
  autoFocusKey?: unknown;
  currentChatId: string | null;
  onEscape?: () => void;
  /** Set the text from outside (suggestion chips). */
  prefill?: { text: string; key: number } | null;
  size?: "panel" | "page";
}) {
  const pages = useStore((s) => s.pages);
  const [text, setText] = useState(initialPrompt);
  const [refs, setRefs] = useState<ChatRef[]>([]);
  const [files, setFiles] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [hash, setHash] = useState<{ query: string; anchor: DOMRect } | null>(null);
  const [at, setAt] = useState<{ query: string; anchor: DOMRect } | null>(null);
  const [toolRefs, setToolRefs] = useState<ToolRef[]>([]);
  const [pageRefs, setPageRefs] = useState<{ id: string; title: string }[]>([]);
  const [pagePick, setPagePick] = useState<DOMRect | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);

  // The field grows with the text (up to a limit), so the layout never jumps.
  const autosize = useCallback(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, size === "page" ? 260 : 200)}px`;
  }, [size]);
  useEffect(autosize, [text, autosize]);

  // Measure the composer so the merged glass body follows its real size.
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drafts follow the conversation; an explicit prompt (from a page or the
  // palette) wins over a saved draft.
  const draftChat = useRef(currentChatId);
  useEffect(() => {
    draftChat.current = currentChatId;
    if (!initialPrompt) setText(readDraft(currentChatId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChatId]);
  useEffect(() => {
    if (draftChat.current === currentChatId) writeDraft(currentChatId, text);
  }, [text, currentChatId]);

  useEffect(() => {
    setText(initialPrompt || readDraft(currentChatId));
    requestAnimationFrame(() => {
      input.current?.focus();
      const l = input.current?.value.length ?? 0;
      input.current?.setSelectionRange(l, l);
    });
  }, [initialPrompt, autoFocusKey]);

  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    requestAnimationFrame(() => input.current?.focus());
  }, [prefill]);

  const addUploads = async (job: Promise<ChatAttachment[]>, count: number) => {
    setUploading((n) => n + count);
    try {
      const added = await job;
      setFiles((f) => [...f, ...added].slice(0, 10));
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    } finally {
      setUploading((n) => Math.max(0, n - count));
    }
  };

  // Files dragged from Explorer onto the composer.
  useEffect(() => {
    if (!isTauri) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop" || !root.current) return;
      const dpr = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(e.payload.position.x / dpr, e.payload.position.y / dpr);
      if (el && root.current.contains(el)) addUploads(uploadPaths(e.payload.paths), e.payload.paths.length);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const pickFiles = async () => {
    const picked = await openDialog({ multiple: true, title: "Attach files for Claude" });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    addUploads(uploadPaths(paths), paths.length);
  };

  const detectHash = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)#([^\s#]*)$/);
    if (m && shell.current) setHash({ query: m[2], anchor: shell.current.getBoundingClientRect() });
    else setHash(null);
    const a = before.match(/(^|\s)@([^\s@]*)$/);
    if (a && shell.current) setAt({ query: a[2], anchor: shell.current.getBoundingClientRect() });
    else setAt(null);
  };

  /** Remove the "@query" being typed, then act on what was picked from the @ menu. */
  const pickMention = (p: MentionPick) => {
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/(^|\s)@[^\s@]*$/, "$1");
    setText(before + text.slice(caret));
    setAt(null);
    if (p.kind === "files") pickFiles();
    else if (p.kind === "context" && shell.current) setPagePick(shell.current.getBoundingClientRect());
    else if (p.kind === "chat") startHash();
    else if (p.kind === "tool") setToolRefs((t) => (t.some((x) => x.id === p.tool.id) ? t : [...t, p.tool]));
    else if (p.kind === "page") setPageRefs((r) => (r.some((x) => x.id === p.id) ? r : [...r, { id: p.id, title: p.title }]));
    requestAnimationFrame(() => el?.focus());
  };

  const pickChat = (c: ChatRef) => {
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/(^|\s)#[^\s#]*$/, "$1");
    setText(before + text.slice(caret));
    setRefs((r) => (r.some((x) => x.id === c.id) ? r : [...r, c]));
    setHash(null);
    requestAnimationFrame(() => el?.focus());
  };

  const startHash = () => {
    setText((t) => (t && !t.endsWith(" ") ? `${t} #` : `${t}#`));
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      detectHash(el.value, el.value.length);
    });
  };

  const submit = () => {
    const body = text.trim();
    if ((!body && !files.length) || busy || uploading) return;
    const clean = (t: string) => t.replace(/[[\]]/g, "");
    const tokens = [
      ...refs.map((r) => `#[${clean(r.title)}](chat:${r.id})`),
      ...pageRefs.map((r) => `@[${clean(r.title)}](page:${r.id})`),
    ].join(" ");
    // Tools travel as short tokens ("@Pages"); the tool names inside are expanded for Claude only.
    const toolTokens = toolRefs.map((t) => `@[${clean(t.label)}](tool:${t.tools.join(",")})`).join(" ");
    onSend([toolTokens ? `${toolTokens} ${body}`.trim() : body, tokens].filter(Boolean).join("\n\n"), files);
    setText("");
    setRefs([]);
    setPageRefs([]);
    setToolRefs([]);
    setFiles([]);
  };

  const plusMenu = (el: HTMLElement) =>
    menuAt(el, [
      { label: "Attach files", icon: "attachment", shortcut: "Paste or drop", onSelect: pickFiles },
      { label: "Work on a page", icon: "page", onSelect: () => setPagePick(el.getBoundingClientRect()) },
      { label: "Bring in a conversation", icon: "assistant", shortcut: "#", onSelect: startHash },
    ]);

  const page = pageId ? pages[pageId] : null;
  const canSend = (!!text.trim() || files.length > 0) && !uploading;
  const hasChips = files.length > 0 || uploading > 0 || !!page || refs.length > 0 || toolRefs.length > 0 || pageRefs.length > 0;

  // One glass body: the round "+" lens melts into the field (bottom-left).
  const P = 46;
  const shapes =
    box.w > 0
      ? [
          { x: P / 2 + 4, y: 0, w: box.w - (P / 2 + 4), h: box.h, r: Math.min(24, box.h / 2) },
          { x: 0, y: box.h - P - 4, w: P, h: P, r: P / 2 },
        ]
      : undefined;

  return (
    <div className={`ai-composer ai-composer-${size} ${busy ? "is-busy" : ""} ${focused ? "is-focused" : ""}`} ref={root}>
      <div className="composer-shell" ref={shell}>
        <span className={`ai-glow ${busy ? "is-working" : focused ? "is-focus" : ""}`} aria-hidden />
        <Glass material="dense" layer={LAYER.popover + 0.3} className="composer-glass" shapes={shapes} merge={14} responsive={false}>
          <span />
        </Glass>
        <button className="composer-plus" aria-label="Add" data-tip="Files, a page, or another chat" onClick={(e) => plusMenu(e.currentTarget)}>
          <Icon name="add" size={20} weight={2} />
        </button>
        <div className="composer-body">
          {hasChips && (
            <div className="composer-chips">
              <AttachmentStrip items={files} onRemove={(id) => setFiles((f) => f.filter((x) => x.id !== id))} />
              {uploading > 0 && (
                <span className="att-uploading">
                  <Spinner size={12} />
                  Adding {uploading} file{uploading === 1 ? "" : "s"}
                </span>
              )}
              {page && (
                <button className="ai-context" onClick={() => onPageId(null)} data-tip="Stop working on this page">
                  <PageIcon icon={page.icon} size={12} />
                  <span className="bidi">{pageTitle(page)}</span>
                  <Icon name="close" size={11} />
                </button>
              )}
              {toolRefs.map((t) => (
                <button key={t.id} className="ai-context is-tool" onClick={() => setToolRefs(toolRefs.filter((x) => x.id !== t.id))} data-tip={t.note}>
                  <ProductIcon name={t.icon} size={14} />
                  <span>{t.label}</span>
                  <Icon name="close" size={11} />
                </button>
              ))}
              {pageRefs.map((r) => (
                <button key={r.id} className="ai-context" onClick={() => setPageRefs(pageRefs.filter((x) => x.id !== r.id))} data-tip="Remove page">
                  <PageIcon icon={pages[r.id]?.icon ?? null} size={12} />
                  <span className="bidi">{r.title}</span>
                  <Icon name="close" size={11} />
                </button>
              ))}
              {refs.map((r) => (
                <button key={r.id} className="ai-context is-chat" onClick={() => setRefs(refs.filter((x) => x.id !== r.id))} data-tip="Remove conversation">
                  <Icon name="assistant" size={12} />
                  <span className="bidi">{r.title}</span>
                  <Icon name="close" size={11} />
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            dir="auto"
            className="composer-input bidi"
            rows={1}
            placeholder={hasMessages ? "Reply to Claude" : page ? "Ask about this page" : "Ask Claude"}
            value={text}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setText(e.target.value);
              detectHash(e.target.value, e.target.selectionStart);
            }}
            onPaste={(e) => {
              const pasted = [...(e.clipboardData?.files ?? [])];
              if (pasted.length) {
                e.preventDefault();
                addUploads(uploadFiles(pasted), pasted.length);
              }
            }}
            onKeyDown={(e) => {
              if ((hash || at) && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab")) return; // handled by the list
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") {
                if (at) setAt(null);
                else if (hash) setHash(null);
                else if (busy) onStop();
                else onEscape?.();
              }
            }}
          />
          <div className="composer-bar">
            <ModelButton />
            <span className="grow" />
            <span className="composer-hint">{busy ? "Esc to stop" : "Enter to send · Shift+Enter for a new line"}</span>
            {busy ? (
              <button className="composer-send is-stop" aria-label="Stop" data-tip="Stop  Esc" onClick={onStop}>
                <span className="stop-square" />
              </button>
            ) : (
              <button className={`composer-send ${canSend ? "is-ready" : ""}`} aria-label="Send" disabled={!canSend} onClick={submit}>
                <Icon name="arrowUp" size={17} weight={2.2} />
              </button>
            )}
          </div>
        </div>
      </div>
      {at && !hash && (
        <MentionMenu anchor={at.anchor} query={at.query} excludeTools={toolRefs.map((t) => t.id)} onPick={pickMention} onClose={() => setAt(null)} />
      )}
      {hash && (
        <ChatPicker
          anchor={hash.anchor}
          query={hash.query}
          exclude={[currentChatId ?? "", ...refs.map((r) => r.id)]}
          onPick={pickChat}
          onClose={() => setHash(null)}
        />
      )}
      {pagePick && <PagePicker anchor={pagePick} onPick={(id) => { onPageId(id); setPagePick(null); }} onClose={() => setPagePick(null)} />}
    </div>
  );
}

/** Keyboard-driven list of conversations for # mentions. */
export function ChatPicker({ anchor, query, exclude, onPick, onClose }: { anchor: DOMRect; query: string; exclude: string[]; onPick: (c: ChatRef) => void; onClose: () => void }) {
  const [chats, setChats] = useState<AiChat[]>([]);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    api.aiChats(300).then(setChats).catch(() => setChats([]));
  }, []);
  const list = useMemo(() => {
    const q = query.toLowerCase();
    return chats.filter((c) => !exclude.includes(c.id) && (!q || c.title.toLowerCase().includes(q))).slice(0, 8);
  }, [chats, query, exclude]);
  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => Math.min(list.length - 1, v + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
      else if ((e.key === "Enter" || e.key === "Tab") && list[sel]) { e.preventDefault(); onPick({ id: list[sel].id, title: list[sel].title }); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list, sel, onPick]);
  return (
    <Popover anchor={new DOMRect(anchor.left, anchor.top - 8, anchor.width, 0)} onClose={onClose} width={320} className="chat-picker">
      <div className="sg-list">
        <div className="sg-group">Conversations</div>
        {list.length === 0 ? (
          <div className="sg-empty">{chats.length ? "No conversation matches." : "No other conversations yet."}</div>
        ) : (
          list.map((c, i) => (
            <div key={c.id} className={`sg-item ${i === sel ? "is-sel" : ""}`} onMouseDown={(e) => { e.preventDefault(); onPick({ id: c.id, title: c.title }); }} onPointerMove={() => setSel(i)}>
              <span className="sg-icon"><Icon name="assistant" size={15} /></span>
              <span className="sg-main">
                <span className="sg-title bidi">{c.title || "New chat"}</span>
                <span className="sg-sub">{relTime(c.updatedAt)}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}

export function PagePicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (id: string) => void; onClose: () => void }) {
  const pages = useStore((s) => s.pages);
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => isResource(p) && !p.deletedAt && (!q.trim() || pageTitle(p).toLowerCase().includes(q.trim().toLowerCase())))
        .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt))
        .slice(0, 10),
    [pages, q],
  );
  return (
    <Popover anchor={new DOMRect(anchor.left, anchor.top - 8, anchor.width, 0)} onClose={onClose} width={300} className="chat-picker">
      <div className="ai-chats-head">
        <SearchField autoFocus size="compact" placeholder="Find a page" value={q} onChange={setQ} onKeyDown={(e) => e.key === "Enter" && list[0] && onPick(list[0].id)} />
      </div>
      <div className="sg-list">
        {list.map((p) => (
          <div key={p.id} className="sg-item" onMouseDown={(e) => { e.preventDefault(); onPick(p.id); }}>
            <span className="sg-icon"><PageIcon icon={p.icon} size={15} /></span>
            <span className="sg-main"><span className="sg-title bidi">{pageTitle(p)}</span></span>
          </div>
        ))}
      </div>
    </Popover>
  );
}
