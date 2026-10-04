import { useEffect, useState } from "react";
import { SearchField } from "../../ui/SearchField";
import { api } from "../../lib/api";
import type { AiChat } from "../../lib/types";
import { Icon } from "../../ui/Icon";
import { EmptyState, relTime, Spinner } from "../../ui/misc";
import { chatsChanged } from "./useChat";

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
