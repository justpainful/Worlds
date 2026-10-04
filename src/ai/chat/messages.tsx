import { useState } from "react";
import { api, errorMessage, fileUrl } from "../../lib/api";
import type { AiMessage, ChatAttachment } from "../../lib/types";
import { useStore, pageTitle } from "../../state/store";
import { Icon, type IconName } from "../../ui/Icon";
import { menuAt, Popover } from "../../ui/Menu";
import { PageIcon, Spinner, formatBytes } from "../../ui/misc";
import { IntelligenceControls, useModelSetting } from "../models";
import { MENTION_TOOLS } from "../mentions";
import { ProductIcon } from "../../ui/ProductIcon";
import { Markdown } from "../markdown";
import { TOOL_LABEL, isAuthError, AuthHelp } from "./tools";
import { type Live } from "./useChat";

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const CHAT_TOKEN = /#\[([^\]]+)\]\(chat:([^)]+)\)|@\[([^\]]+)\]\(tool:([^)]+)\)/g;

export function UserText({ text, onOpenChat }: { text: string; onOpenChat: (id: string) => void }) {
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

export function AttachmentStrip({ items, onRemove }: { items: ChatAttachment[]; onRemove?: (id: string) => void }) {
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

export function MessageView({
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

export const SUGGESTIONS_PAGE = [
  "Summarise this page in five bullet points",
  "Turn this page into a checklist",
  "Translate this page to English",
  "ترجم هذه الصفحة للعربية",
  "Find and fix unclear sentences",
];
export const SUGGESTIONS_ANY = [
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
