import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { ChatEmpty, ChatList, Composer, MessageList, readLastChat, useChat } from "../ai/chat";

/** Claude as a full view: conversations on the side, the chat in the middle. Opens in any pane or tab. */
export function ChatView({ chatId, paneId }: { chatId?: string; paneId: string }) {
  const chat = useChat(chatId ?? readLastChat());
  const [pageId, setPageId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatId && chatId !== chat.chatId) chat.setChatId(chatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Keep the tab's route in sync so the session restores the open conversation.
  useEffect(() => {
    const s = useStore.getState();
    const pane = s.layout.panes.find((p) => p.id === paneId);
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId);
    if (tab?.route.kind === "chat" && tab.route.chatId !== (chat.chatId ?? undefined)) {
      useStore.setState({
        layout: {
          ...s.layout,
          panes: s.layout.panes.map((p) =>
            p.id !== paneId ? p : { ...p, tabs: p.tabs.map((t) => (t.id === tab.id ? { ...t, route: { kind: "chat", chatId: chat.chatId ?? undefined } } : t)) },
          ),
        },
      });
    }
  }, [chat.chatId, paneId]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.live?.steps.length, chat.live?.status, chat.live?.text]);

  return (
    <div className={`chat-view ${chat.messages.length || chat.live ? "" : "is-empty"}`}>
      <aside className="chat-view-side">
        <ChatList
          current={chat.chatId}
          onOpen={(id) => !chat.busy && chat.setChatId(id)}
          onNew={() => !chat.busy && chat.setChatId(null)}
          onDeleted={(id) => id === chat.chatId && chat.setChatId(null)}
          onRenamed={(id, t) => id === chat.chatId && chat.setTitle(t)}
        />
      </aside>
      <section className="chat-view-main">
        <header className="chat-view-head" data-drag-zone>
          <h1 className="chat-view-title bidi">{chat.title || "New chat"}</h1>
        </header>
        <div className="chat-view-feed scroll" ref={feed}>
          <div className="chat-view-column">
            <MessageList
              messages={chat.messages}
              live={chat.live}
              loading={chat.loading}
              onUndo={chat.undo}
              onRetry={chat.retry}
              contextPageId={pageId}
              onOpenChat={(id) => !chat.busy && chat.setChatId(id)}
              empty={<ChatEmpty hasPage={!!pageId} onPick={(text) => setPrefill({ text, key: Date.now() })} />}
            />
          </div>
        </div>
        <div className="chat-view-compose">
          <Composer
            busy={chat.busy}
            pageId={pageId}
            onPageId={setPageId}
            onSend={(p, files) => chat.send(p, pageId, files)}
            prefill={prefill}
            onStop={chat.stop}
            hasMessages={chat.messages.length > 0}
            currentChatId={chat.chatId}
            size="page"
          />
        </div>
      </section>
    </div>
  );
}
