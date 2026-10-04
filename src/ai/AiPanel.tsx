import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { on } from "../lib/bus";
import { useStore, pageTitle } from "../state/store";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { GlassGroup } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Popover } from "../ui/Menu";
import { PageIcon } from "../ui/misc";
import {
  ChatEmpty,
  ChatList,
  Composer,
  MessageList,
  readLastChat,
  useChat,
} from "./chat";

type Mode = "ask" | "panel";

function activePageId(): string | null {
  const s = useStore.getState();
  const pane = s.layout.panes.find((p) => p.id === s.layout.activePaneId);
  const route = pane?.tabs.find((t) => t.id === pane.activeTabId)?.route;
  return route?.kind === "page" ? route.pageId : null;
}

/**
 * Claude, everywhere:
 *   Ctrl+J       → the quick-ask capsule (Apple Intelligence style)
 *   anywhere else → the conversation panel (a tall glass sheet)
 * One conversation state is shared by both, so asking in the capsule
 * continues in the panel without a jump.
 */
export function AiHost() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [initial, setInitial] = useState<{
    pageId: string | null;
    prompt: string;
    key: number;
  }>({ pageId: null, prompt: "", key: 0 });
  const chat = useChat(readLastChat());

  useEffect(
    () =>
      on("ai:open", ({ pageId, prompt }) => {
        setInitial({ pageId, prompt: prompt ?? "", key: Date.now() });
        setMode("panel");
      }),
    [],
  );
  useEffect(() => {
    const toggle = () =>
      setMode((m) => {
        if (m) return null;
        setInitial({ pageId: activePageId(), prompt: "", key: Date.now() });
        return "ask";
      });
    window.addEventListener("worlds:toggle-ai", toggle);
    return () => window.removeEventListener("worlds:toggle-ai", toggle);
  }, []);

  if (!mode) return null;
  return createPortal(
    mode === "ask" ? (
      <QuickAsk
        initialPageId={initial.pageId}
        onClose={() => setMode(null)}
        onShowConversation={() => setMode("panel")}
        onSubmit={(text, pageId, files) => {
          chat.send(text, pageId, files, { newChat: true });
          setInitial({ pageId, prompt: "", key: Date.now() });
          setMode("panel");
        }}
      />
    ) : (
      <AiPanel chat={chat} initial={initial} onClose={() => setMode(null)} />
    ),
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Quick ask capsule
// ---------------------------------------------------------------------------

function QuickAsk({
  initialPageId,
  onClose,
  onSubmit,
  onShowConversation,
}: {
  initialPageId: string | null;
  onClose: () => void;
  onSubmit: (text: string, pageId: string | null, files: []) => void;
  onShowConversation: () => void;
}) {
  const pages = useStore((s) => s.pages);
  const [text, setText] = useState("");
  const [pageId, setPageId] = useState<string | null>(initialPageId);
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const page = pageId ? pages[pageId] : null;

  useEffect(() => {
    const r = requestAnimationFrame(() => {
      setShown(true);
      input.current?.focus();
    });
    return () => cancelAnimationFrame(r);
  }, []);

  const autosize = useCallback(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);
  useEffect(autosize, [text, autosize]);

  return (
    <div
      className={`quick-ask-root ${shown ? "is-in" : ""}`}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="quick-ask">
        <div className="quick-ask-field">
          <span className="ai-glow is-focus is-large" aria-hidden />
          <Glass
            material="dense"
            layer={LAYER.modal}
            className="quick-ask-glass"
            radius="32px"
          >
            <div className="quick-ask-row">
              <textarea
                ref={input}
                dir="auto"
                rows={1}
                className="quick-ask-input bidi"
                value={text}
                placeholder="Ask Claude"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    if (text.trim()) onSubmit(text.trim(), pageId, []);
                  }
                  if (e.key === "Escape") onClose();
                }}
              />
              {text.trim() && (
                <span className="quick-ask-hint">Ask Claude</span>
              )}
            </div>
          </Glass>
        </div>
        <div className="quick-ask-pills">
          {page ? (
            <Glass
              material="clear"
              layer={LAYER.modal}
              className="qa-pill"
              radius="var(--r-capsule)"
            >
              <button
                className="qa-pill-btn"
                onClick={() => setPageId(null)}
                data-tip="Ask without this page"
              >
                <PageIcon icon={page.icon} size={14} />
                <span className="bidi">{pageTitle(page)}</span>
                <Icon name="close" size={11} />
              </button>
            </Glass>
          ) : null}
          <Glass
            material="clear"
            layer={LAYER.modal}
            className="qa-pill"
            radius="var(--r-capsule)"
          >
            <button className="qa-pill-btn" onClick={onShowConversation}>
              <Icon name="assistant" size={14} />
              <span>Show conversation</span>
            </button>
          </Glass>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation panel
// ---------------------------------------------------------------------------

function AiPanel({
  chat,
  initial,
  onClose,
}: {
  chat: ReturnType<typeof useChat>;
  initial: { pageId: string | null; prompt: string; key: number };
  onClose: () => void;
}) {
  const open = useStore((s) => s.open);
  const [pageId, setPageId] = useState<string | null>(initial.pageId);
  const [listAnchor, setListAnchor] = useState<DOMRect | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(
    null,
  );
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => setPageId(initial.pageId), [initial]);
  useEffect(() => {
    feed.current?.scrollTo({
      top: feed.current.scrollHeight,
      behavior: "smooth",
    });
  }, [
    chat.messages.length,
    chat.live?.steps.length,
    chat.live?.status,
    chat.live?.text,
  ]);

  const newChat = () => {
    if (chat.busy) return;
    chat.setChatId(null);
    setListAnchor(null);
  };

  return (
    <Glass
      material="dense"
      layer={LAYER.popover}
      className="ai-panel"
      radius="30px"
      role="dialog"
      aria-label="Claude"
    >
      <div className="ai-panel-head">
        <GlassGroup className="ai-panel-close" layer={LAYER.popover + 0.4} material="control" items={[{ icon: "close", label: "Close", shortcut: "Ctrl+J", onClick: onClose }]} />
        <button className="ai-chat-switch" onClick={(e) => setListAnchor(e.currentTarget.getBoundingClientRect())} aria-label="Conversations">
          <span className="ai-chat-title bidi">{chat.title || "New chat"}</span>
          <Icon name="chevronDown" size={12} />
        </button>
        <GlassGroup
          className="ai-panel-head-end"
          layer={LAYER.popover + 0.4}
          material="control"
          items={[
            { icon: "edit", label: "New chat", onClick: newChat, disabled: chat.busy },
            {
              icon: "expand",
              label: "Open in a tab",
              onClick: () => {
                open({ kind: "chat", chatId: chat.chatId ?? undefined }, "tab");
                onClose();
              },
            },
          ]}
        />
      </div>

      <div className="ai-feed scroll" ref={feed}>
        <MessageList
          messages={chat.messages}
          live={chat.live}
          loading={chat.loading}
          onUndo={chat.undo}
          onRetry={chat.retry}
          contextPageId={pageId}
          onOpenChat={(id) => !chat.busy && chat.setChatId(id)}
          empty={
            <ChatEmpty
              hasPage={!!pageId}
              onPick={(text) => setPrefill({ text, key: Date.now() })}
            />
          }
        />
      </div>

      <div className="ai-panel-compose">
        <Composer
          busy={chat.busy}
          pageId={pageId}
          onPageId={setPageId}
          onSend={(p, files) => chat.send(p, pageId, files)}
          prefill={prefill}
          onStop={chat.stop}
          hasMessages={chat.messages.length > 0}
          initialPrompt={initial.prompt}
          autoFocusKey={initial.key}
          currentChatId={chat.chatId}
          onEscape={onClose}
        />
      </div>

      {listAnchor && (
        <Popover
          anchor={listAnchor}
          onClose={() => setListAnchor(null)}
          width={340}
          className="ai-chats"
        >
          <ChatList
            current={chat.chatId}
            autoFocus
            onOpen={(id) => {
              setListAnchor(null);
              if (!chat.busy) chat.setChatId(id);
            }}
            onNew={newChat}
            onDeleted={(id) => id === chat.chatId && newChat()}
            onRenamed={(id, t) => id === chat.chatId && chat.setTitle(t)}
          />
        </Popover>
      )}
    </Glass>
  );
}
