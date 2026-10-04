import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchField } from "../ui/SearchField";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, fileUrl, isTauri } from "../lib/api";
import type { AiChat, AiMessage, Attachment, ChatAttachment } from "../lib/types";
import { useStore, pageTitle } from "../state/store";
import { Icon, type IconName } from "../ui/Icon";
import { menuAt, Popover } from "../ui/Menu";
import { EmptyState, PageIcon, relTime, Spinner, formatBytes } from "../ui/misc";
import { Glass } from "../glass/Glass";
import { IntelligenceControls, useModelSetting } from "./models";
import { MENTION_TOOLS, MentionMenu, type MentionPick, type ToolRef } from "./mentions";
import { ProductIcon } from "../ui/ProductIcon";
import { LAYER } from "../glass/materials";
import { Markdown } from "./markdown";

const toChatAttachment = (a: Attachment): ChatAttachment => ({ id: a.id, name: a.fileName, mime: a.mime, kind: a.kind, size: a.size });

/** Big photos are scaled down before Claude sees them (the API caps images at ~5 MB). */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 3_400_000) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.86));
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}

async function uploadFiles(files: File[]): Promise<ChatAttachment[]> {
  const out: ChatAttachment[] = [];
  for (const f of files) {
    const small = await shrinkImage(f);
    const name = small.name || `pasted-${Date.now()}.${(small.type.split("/")[1] || "bin").replace("jpeg", "jpg")}`;
    const a = await api.importBytes(null, name, new Uint8Array(await small.arrayBuffer()));
    out.push(toChatAttachment(a));
  }
  return out;
}

async function uploadPaths(paths: string[]): Promise<ChatAttachment[]> {
  const out: ChatAttachment[] = [];
  for (const p of paths) out.push(toChatAttachment(await api.importFile(null, p)));
  return out;
}

// ---------------------------------------------------------------------------
// Tool labels
// ---------------------------------------------------------------------------

export const TOOL_LABEL: Record<string, [string, IconName]> = {
  pages_search: ["Searching pages", "search"],
  pages_list: ["Looking through your pages", "pages"],
  pages_read: ["Reading a page", "page"],
  pages_create: ["Creating a page", "add"],
  pages_rename: ["Renaming a page", "edit"],
  pages_move: ["Moving a page", "move"],
  pages_archive: ["Archiving a page", "archive"],
  pages_set_icon: ["Setting a page icon", "emoji"],
  pages_pin: ["Pinning a page", "pin"],
  pages_favorite: ["Marking a favourite", "favorite"],
  pages_duplicate: ["Duplicating a page", "duplicate"],
  pages_delete: ["Moving a page to Trash", "delete"],
  pages_restore: ["Restoring from Trash", "restore"],
  pages_replace_content: ["Rewriting a page", "edit"],
  trash_list: ["Looking in Trash", "delete"],
  blocks_read: ["Reading blocks", "page"],
  blocks_insert: ["Adding content", "add"],
  blocks_update: ["Editing a block", "edit"],
  blocks_move: ["Reordering blocks", "move"],
  blocks_delete: ["Removing a block", "delete"],
  references_search: ["Checking references", "mention"],
  references_resolve: ["Finding a page to mention", "mention"],
  attachments_add: ["Attaching a file", "attachment"],
  attachments_read_metadata: ["Checking attachments", "attachment"],
  templates_list: ["Looking at templates", "template"],
  templates_instantiate: ["Creating from a template", "template"],
  templates_create_from_page: ["Saving a template", "template"],
  automations_list: ["Checking automations", "automation"],
  automations_create: ["Creating an automation", "schedule"],
  automations_update: ["Updating an automation", "schedule"],
  automations_delete: ["Deleting an automation", "delete"],
  automations_run: ["Requesting an automation run", "automation"],
  discord_inspect: ["Checking Discord destinations", "discord"],
  discord_preview: ["Rendering a Discord preview", "discord"],
  discord_send: ["Queuing a Discord message for your approval", "discord"],
  discord_edit: ["Queuing a Discord edit for your approval", "discord"],
  profile_read: ["Reading your profile", "profile"],
  profile_update: ["Updating your profile", "profile"],
  history_read: ["Reading history", "history"],
  instructions_read: ["Reading assistant instructions", "instructions"],
  instructions_update: ["Updating assistant instructions", "instructions"],
  chats_search: ["Looking through earlier chats", "assistant"],
  chats_read: ["Reading an earlier chat", "assistant"],
};

export const isAuthError = (t?: string | null) => !!t && /failed to authenticate|oauth|not logged in|please run \/login|invalid api key/i.test(t);

/** Claude Code's own sign-in expired: Worlds cannot (and should not) log in for the user. */
export function AuthHelp() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="warn warn-warn ai-auth">
      <Icon name="lock" size={14} />
      <div>
        <div><strong>Claude Code needs you to sign in again.</strong></div>
        <div>Worlds runs your local Claude Code, and its login has expired. Open a terminal, run the command below, finish the sign-in in your browser, then ask again.</div>
        <div className="ai-auth-cmd">
          <code dir="ltr">claude auth login</code>
          <button className="chip-btn" onClick={() => { navigator.clipboard.writeText("claude auth login"); setCopied(true); }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation state
// ---------------------------------------------------------------------------

const LAST_CHAT = "worlds.ai.chat";
export function readLastChat(): string | null {
  try {
    return localStorage.getItem(LAST_CHAT);
  } catch {
    return null;
  }
}
function writeLastChat(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_CHAT, id);
    else localStorage.removeItem(LAST_CHAT);
  } catch {
    /* per-viewer convenience only */
  }
}

/** Tell every open chat list to refresh. */
export function chatsChanged() {
  window.dispatchEvent(new Event("worlds:chats"));
}

interface Live {
  runId: string;
  steps: { tool: string; ok: boolean | null }[];
  status: "running" | "error";
  error?: string;
  /** Answer text streamed so far. */
  text?: string;
}

export function useChat(initialChatId: string | null) {
  const [chatId, setChatIdState] = useState<string | null>(initialChatId);
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;

  const load = useCallback(async (id: string | null) => {
    if (!id) {
      setMessages([]);
      setTitle("");
      return;
    }
    setLoading(true);
    try {
      const [chat, list] = await Promise.all([api.aiChat(id), api.aiChats(500)]);
      const meta = list.find((c) => c.id === id);
      if (!meta) {
        setChatIdState(null);
        writeLastChat(null);
        setMessages([]);
        setTitle("");
        return;
      }
      setMessages(chat.messages);
      setTitle(meta.title);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(chatId);
  }, [chatId, load]);

  useEffect(() => {
    const un = listen<{ runId: string; kind: string; tool?: string; text?: string; error?: boolean; chatId?: string; pages?: { id: string }[] }>("worlds://ai", (e) => {
      const p = e.payload;
      const cur = liveRef.current;
      if (!cur || cur.runId !== p.runId) return;
      if (p.kind === "tool") setLive({ ...cur, steps: [...cur.steps, { tool: p.tool ?? "", ok: null }] });
      else if (p.kind === "text" && p.text) setLive({ ...cur, text: cur.text ? `${cur.text}\n\n${p.text}` : p.text });
      else if (p.kind === "tool_result") {
        const steps = [...cur.steps];
        const idx = steps.map((s) => s.ok).lastIndexOf(null);
        if (idx >= 0) steps[idx] = { ...steps[idx], ok: !p.error };
        setLive({ ...cur, steps });
      } else if (p.kind === "done" || p.kind === "error") {
        setLive(null);
        if (p.chatId) load(p.chatId);
        chatsChanged();
        const s = useStore.getState();
        s.refreshPages();
        for (const pg of p.pages ?? []) s.bumpExternal(pg.id);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [load]);

  const setChatId = useCallback((id: string | null) => {
    setChatIdState(id);
    writeLastChat(id);
  }, []);

  const send = useCallback(
    async (prompt: string, pageId: string | null, attachments: ChatAttachment[] = [], opts: { newChat?: boolean } = {}) => {
      if ((!prompt.trim() && !attachments.length) || liveRef.current) return;
      const text = prompt.trim() || (attachments.length === 1 ? "Take a look at this file." : "Take a look at these files.");
      const optimistic: AiMessage = { id: `tmp-${Date.now()}`, role: "user", content: text, steps: [], opId: null, meta: { pageId, attachments }, createdAt: Date.now() };
      if (opts.newChat) {
        setMessages([optimistic]);
        setTitle("");
      } else setMessages((m) => [...m, optimistic]);
      try {
        const { runId, chatId: cid } = await api.aiRun({ prompt: text, pageId, chatId: opts.newChat ? null : chatId, attachments: attachments.map((a) => a.id) });
        setLive({ runId, steps: [], status: "running" });
        if (cid !== chatId) {
          setChatId(cid);
          chatsChanged();
        }
      } catch (e) {
        setLive({ runId: "", steps: [], status: "error", error: errorMessage(e) });
      }
    },
    [chatId, setChatId],
  );

  const stop = useCallback(async () => {
    const cur = liveRef.current;
    if (!cur) return;
    await api.aiCancel(cur.runId);
    setLive(null);
    if (chatId) load(chatId);
  }, [chatId, load]);

  const undo = useCallback(async (m: AiMessage) => {
    if (!m.opId) return;
    try {
      await api.undoOp(m.opId);
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, meta: { ...x.meta, undone: true } } : x)));
      const s = useStore.getState();
      s.toast({ message: "Claude’s changes were undone", tone: "success" });
      await s.refreshPages();
      for (const p of m.meta.pages ?? []) s.bumpExternal(p.id);
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  }, []);

  /** Ask the last question again (with its files and page). */
  const retry = useCallback(() => {
    const last = [...messages].reverse().find((m) => m.role === "user");
    if (last) send(last.content, last.meta.pageId ?? null, last.meta.attachments ?? []);
  }, [messages, send]);

  return { chatId, setChatId, title, setTitle, messages, loading, live, send, retry, stop, undo, busy: !!live && live.status === "running" };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const CHAT_TOKEN = /#\[([^\]]+)\]\(chat:([^)]+)\)|@\[([^\]]+)\]\(tool:([^)]+)\)/g;

function UserText({ text, onOpenChat }: { text: string; onOpenChat: (id: string) => void }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(CHAT_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    if (m[3]) {
      const tool = MENTION_TOOLS.find((t) => t.label === m[3]);
      parts.push(
        <span key={k++} className="tool-chip isolate" data-tip={tool?.note}>
          {tool && <ProductIcon name={tool.icon} size={14} />}@{m[3]}
        </span>,
      );
    } else {
      parts.push(
        <button key={k++} className="chat-chip isolate" onClick={() => onOpenChat(m[2])}>
          <Icon name="assistant" size={11} />
          {m[1]}
        </button>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function MessageList({
  messages,
  live,
  loading,
  onUndo,
  onOpenChat,
  onRetry,
  contextPageId,
  empty,
}: {
  messages: AiMessage[];
  live: Live | null;
  loading: boolean;
  onUndo: (m: AiMessage) => void;
  onOpenChat: (id: string) => void;
  onRetry: () => void;
  contextPageId: string | null;
  empty: React.ReactNode;
}) {
  if (loading && messages.length === 0) return <Spinner />;
  if (messages.length === 0 && !live) return <>{empty}</>;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  return (
    <>
      {messages.map((m) => (
        <MessageView
          key={m.id}
          m={m}
          onUndo={() => onUndo(m)}
          onOpenChat={onOpenChat}
          onRetry={m.id === lastAssistant && !live ? onRetry : undefined}
          contextPageId={contextPageId}
        />
      ))}
      {live && (
        <div className="ai-turn">
          {live.steps.map((s, i) => (
            <div key={i} className={`ai-step ${s.ok === false ? "is-error" : ""}`}>
              <Icon name={TOOL_LABEL[s.tool]?.[1] ?? "settings"} size={13} />
              <span>{TOOL_LABEL[s.tool]?.[0] ?? s.tool}</span>
              {s.ok === null ? <Spinner size={12} /> : s.ok ? <Icon name="check" size={12} /> : <Icon name="error" size={12} />}
            </div>
          ))}
          {live.status === "running" ? (
            live.text ? (
              <div className="ai-answer is-streaming">
                <Markdown text={live.text} onOpenChat={onOpenChat} />
              </div>
            ) : (
              <div className="ai-thinking">
                <span className="shimmer">{live.steps.length ? "Working" : "Thinking"}</span>
              </div>
            )
          ) : isAuthError(live.error) ? (
            <AuthHelp />
          ) : (
            <div className="warn warn-error">
              <Icon name="error" size={14} />
              <span>{live.error}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function AttachmentStrip({ items, onRemove }: { items: ChatAttachment[]; onRemove?: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="att-strip">
      {items.map((a) =>
        a.mime.startsWith("image/") ? (
          <span key={a.id} className="att-thumb">
            <img src={fileUrl(a.id)} alt={a.name} crossOrigin="anonymous" draggable={false} />
            {onRemove && (
              <button className="att-x" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)}>
                <Icon name="close" size={11} />
              </button>
            )}
          </span>
        ) : (
          <span key={a.id} className="att-file">
            <Icon name={a.mime === "application/pdf" ? "page" : "file"} size={14} />
            <span className="att-file-name isolate" dir="auto">{a.name}</span>
            <span className="att-file-size">{formatBytes(a.size)}</span>
            {onRemove && (
              <button className="att-x" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)}>
                <Icon name="close" size={11} />
              </button>
            )}
          </span>
        ),
      )}
    </div>
  );
}

function MessageView({
  m,
  onUndo,
  onOpenChat,
  onRetry,
  contextPageId,
}: {
  m: AiMessage;
  onUndo: () => void;
  onOpenChat: (id: string) => void;
  onRetry?: () => void;
  contextPageId: string | null;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const [copied, setCopied] = useState(false);
  const pages = useStore((s) => s.pages);
  if (m.role === "user") {
    const ctx = m.meta.pageId ? pages[m.meta.pageId] : null;
    return (
      <div className="ai-user">
        {ctx && (
          <span className="ai-user-ctx">
            <PageIcon icon={ctx.icon} size={11} />
            <span className="bidi">{pageTitle(ctx)}</span>
          </span>
        )}
        <AttachmentStrip items={m.meta.attachments ?? []} />
        <div className="ai-prompt bidi" dir="auto">
          <UserText text={m.content} onOpenChat={onOpenChat} />
        </div>
      </div>
    );
  }
  if (isAuthError(m.content)) return <AuthHelp />;
  if (m.meta.isError) {
    return (
      <div className="ai-turn">
        <div className="warn warn-error">
          <Icon name="error" size={14} />
          <span>{m.content}</span>
        </div>
        {onRetry && (
          <div className="ai-actions is-visible">
            <button className="ai-act" onClick={onRetry}><Icon name="refresh" size={13} />Try again</button>
          </div>
        )}
      </div>
    );
  }
  const changes = m.meta.changeCount ?? 0;

  const addToPage = (pageId: string) =>
    api
      .pageAppendMarkdown(pageId, m.content)
      .then((n) => {
        const s = useStore.getState();
        s.bumpExternal(pageId);
        s.toast({
          message: `Added ${n} block${n === 1 ? "" : "s"} to “${pageTitle(s.pages[pageId])}”`,
          tone: "success",
          action: { label: "Open", run: () => s.openPage(pageId) },
        });
      })
      .catch((e) => useStore.getState().toast({ message: errorMessage(e), tone: "error" }));

  const pickPage = (el: HTMLElement) => {
    const recent = Object.values(useStore.getState().pages)
      .filter((p) => p.kind === "page" && !p.deletedAt)
      .sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt))
      .slice(0, 10);
    menuAt(
      el,
      [
        { kind: "label", label: "Add this answer to" },
        ...recent.map((p) => ({ label: pageTitle(p), icon: "page" as IconName, onSelect: () => addToPage(p.id) })),
        { kind: "separator" },
        {
          label: "New page",
          icon: "add",
          onSelect: async () => {
            const s = useStore.getState();
            const meta = await api.createPage({ title: m.content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 60) ?? "" , markdown: m.content });
            await s.refreshPages();
            s.openPage(meta.id, "tab");
          },
        },
      ],
      "start",
    );
  };

  return (
    <div className="ai-turn">
      {m.steps.length > 0 && (
        <button className="ai-steps-toggle" onClick={() => setShowSteps((v) => !v)}>
          <Icon name="settings" size={12} />
          {m.steps.length} step{m.steps.length === 1 ? "" : "s"}
          <Icon name="chevronDown" size={11} className={showSteps ? "is-flipped" : ""} />
        </button>
      )}
      {showSteps &&
        m.steps.map((s, i) => (
          <div key={i} className={`ai-step ${s.ok === false ? "is-error" : ""}`}>
            <Icon name={TOOL_LABEL[s.tool]?.[1] ?? "settings"} size={13} />
            <span>{TOOL_LABEL[s.tool]?.[0] ?? s.tool}</span>
            {s.ok === false ? <Icon name="error" size={12} /> : <Icon name="check" size={12} />}
          </div>
        ))}
      {m.content && (
        <div className="ai-answer">
          <Markdown text={m.content} onOpenChat={onOpenChat} />
        </div>
      )}
      {changes > 0 && (
        <div className={`ai-result ${m.meta.undone ? "is-undone" : ""}`}>
          <span>
            {m.meta.undone ? "Undone · " : ""}
            {changes} change{changes === 1 ? "" : "s"}
            {m.meta.pages?.length ? ` on ${m.meta.pages.map((p) => p.title || "Untitled").join(", ")}` : ""}
          </span>
          <span className="grow" />
          {m.meta.pages?.[0] && (
            <button className="chip-btn" onClick={() => useStore.getState().openPage(m.meta.pages![0].id, "current")}>Open</button>
          )}
          {!m.meta.undone && (
            <button className="chip-btn" onClick={onUndo}>
              <Icon name="undo" size={12} />
              Undo
            </button>
          )}
        </div>
      )}
      {m.content && (
        <div className="ai-actions">
          <button
            className="ai-act"
            onClick={() => {
              navigator.clipboard.writeText(m.content);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
          >
            <Icon name={copied ? "check" : "duplicate"} size={13} />
            {copied ? "Copied" : "Copy"}
          </button>
          {contextPageId ? (
            <button className="ai-act" onClick={() => addToPage(contextPageId)} onContextMenu={(e) => { e.preventDefault(); pickPage(e.currentTarget); }}>
              <Icon name="add" size={13} />
              Add to page
            </button>
          ) : (
            <button className="ai-act" onClick={(e) => pickPage(e.currentTarget)}>
              <Icon name="add" size={13} />
              Add to page
            </button>
          )}
          {onRetry && (
            <button className="ai-act" onClick={onRetry}>
              <Icon name="refresh" size={13} />
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const SUGGESTIONS_PAGE = [
  "Summarise this page in five bullet points",
  "Turn this page into a checklist",
  "Translate this page to English",
  "ترجم هذه الصفحة للعربية",
  "Find and fix unclear sentences",
];
const SUGGESTIONS_ANY = [
  "What did I work on this week?",
  "Plan my week from my pages",
  "Create a page for a new project",
  "Find pages I haven't touched in a month",
];

export function ChatEmpty({ hasPage, onPick }: { hasPage: boolean; onPick: (text: string) => void }) {
  return (
    <div className="ai-empty">
      <div className="ai-empty-title">Ask anything about your pages</div>
      <div className="ai-empty-text">
        Claude can write and reorganise pages, read images and PDFs you attach, manage templates, Trash and automations, update your profile, and prepare Discord messages for your approval.
        Type <kbd>#</kbd> to bring in an earlier conversation. Every change can be undone.
      </div>
      <div className="ai-suggest">
        {(hasPage ? SUGGESTIONS_PAGE : SUGGESTIONS_ANY).map((s) => (
          <button key={s} className="ai-suggest-chip bidi" dir="auto" onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Quick model switch (applies to the next messages). */
export function ModelButton() {
  const m = useModelSetting();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button className="ai-model-btn" onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} aria-label="Model and effort">
        <span className="ai-model-dot" style={{ ["--lvl" as string]: m.modelIndex }} />
        {m.model.name} · {m.effort.name}
        <Icon name="chevronDown" size={11} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={320} className="intel-pop">
          <IntelligenceControls />
        </Popover>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Composer: text, page context, #conversation references
// ---------------------------------------------------------------------------

interface ChatRef {
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

  useEffect(() => {
    setText(initialPrompt);
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
function ChatPicker({ anchor, query, exclude, onPick, onClose }: { anchor: DOMRect; query: string; exclude: string[]; onPick: (c: ChatRef) => void; onClose: () => void }) {
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

function PagePicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (id: string) => void; onClose: () => void }) {
  const pages = useStore((s) => s.pages);
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.kind === "page" && !p.deletedAt && (!q.trim() || pageTitle(p).toLowerCase().includes(q.trim().toLowerCase())))
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

// ---------------------------------------------------------------------------
// Conversation list (popover in the panel, sidebar in the full view)
// ---------------------------------------------------------------------------

export function ChatList({ current, onOpen, onNew, onDeleted, onRenamed, autoFocus }: {
  current: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, title: string) => void;
  autoFocus?: boolean;
}) {
  const [chats, setChats] = useState<AiChat[] | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const load = () => api.aiChats(500).then(setChats).catch(() => setChats([]));
    load();
    window.addEventListener("worlds:chats", load);
    return () => window.removeEventListener("worlds:chats", load);
  }, []);
  const list = (chats ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));

  // Group by recency like a mail client.
  const groups: { label: string; items: AiChat[] }[] = [];
  const dayStart = new Date().setHours(0, 0, 0, 0);
  for (const c of list) {
    const label = c.updatedAt >= dayStart ? "Today" : c.updatedAt >= dayStart - 86_400_000 ? "Yesterday" : c.updatedAt >= dayStart - 7 * 86_400_000 ? "This week" : "Earlier";
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(c);
    else groups.push({ label, items: [c] });
  }

  return (
    <div className="chat-list">
      <div className="ai-chats-head">
        <SearchField size="compact" placeholder="Search conversations" value={q} onChange={setQ} autoFocus={autoFocus} />
        <button className="chip-btn" onClick={onNew}>
          <Icon name="add" size={13} />
          New
        </button>
      </div>
      <div className="ai-chats-list scroll">
        {!chats ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState compact icon="assistant" title={chats.length ? "No matches" : "No conversations yet"} text={chats.length ? undefined : "Your chats with Claude are kept here."} />
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="sg-group">{g.label}</div>
              {g.items.map((c) => (
                <div key={c.id} className={`ai-chat-row ${c.id === current ? "is-current" : ""}`} onClick={() => editing !== c.id && onOpen(c.id)}>
                  {editing === c.id ? (
                    <input
                      className="field bidi"
                      dir="auto"
                      autoFocus
                      value={draft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter" && draft.trim()) {
                          await api.aiChatRename(c.id, draft.trim());
                          setChats((l) => (l ?? []).map((x) => (x.id === c.id ? { ...x, title: draft.trim() } : x)));
                          onRenamed(c.id, draft.trim());
                          setEditing(null);
                          chatsChanged();
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                      onBlur={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      <span className="ai-chat-row-main">
                        <span className="ai-chat-row-title bidi">{c.title || "New chat"}</span>
                        <span className="ai-chat-row-sub">{relTime(c.updatedAt)}</span>
                      </span>
                      <button className="ai-chat-row-btn" aria-label="Rename" onClick={(e) => { e.stopPropagation(); setDraft(c.title); setEditing(c.id); }}>
                        <Icon name="edit" size={13} />
                      </button>
                      <button
                        className="ai-chat-row-btn"
                        aria-label="Delete conversation"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await api.aiChatDelete(c.id);
                          setChats((l) => (l ?? []).filter((x) => x.id !== c.id));
                          onDeleted(c.id);
                          chatsChanged();
                        }}
                      >
                        <Icon name="delete" size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
