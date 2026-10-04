import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage } from "../../lib/api";
import type { AiMessage, ChatAttachment } from "../../lib/types";
import { useStore } from "../../state/store";

// ---------------------------------------------------------------------------
// Conversation state
// ---------------------------------------------------------------------------

export const LAST_CHAT = "worlds.ai.chat";
export function readLastChat(): string | null {
  try {
    return localStorage.getItem(LAST_CHAT);
  } catch {
    return null;
  }
}
export function writeLastChat(id: string | null) {
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

export type AiEvent = { runId: string; kind: string; tool?: string; text?: string; error?: boolean; chatId?: string; pages?: { id: string }[] };

/**
 * Run events can arrive before `ai_run` has returned the run id (a fast tool
 * call, or a run that fails at once). They wait here, briefly, and are
 * replayed as soon as the run is known, so no step is lost and a run that
 * finished early never leaves the chat stuck on "working".
 */
export const early = new Map<string, { at: number; events: AiEvent[] }>();
export function holdEarly(e: AiEvent) {
  const now = Date.now();
  for (const [id, v] of early) if (now - v.at > 60_000) early.delete(id);
  const slot = early.get(e.runId) ?? { at: now, events: [] };
  slot.events.push(e);
  early.set(e.runId, slot);
}

export interface Live {
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

  /** Apply one run event to the live state (kept in a ref so replays chain correctly). */
  const apply = useCallback(
    (p: AiEvent) => {
      const cur = liveRef.current;
      if (!cur || cur.runId !== p.runId) return false;
      let next: Live | null = cur;
      if (p.kind === "tool") next = { ...cur, steps: [...cur.steps, { tool: p.tool ?? "", ok: null }] };
      else if (p.kind === "text" && p.text) next = { ...cur, text: cur.text ? `${cur.text}\n\n${p.text}` : p.text };
      else if (p.kind === "tool_result") {
        const steps = [...cur.steps];
        const idx = steps.map((s) => s.ok).lastIndexOf(null);
        if (idx >= 0) steps[idx] = { ...steps[idx], ok: !p.error };
        next = { ...cur, steps };
      } else if (p.kind === "done" || p.kind === "error") {
        next = null;
        if (p.chatId) load(p.chatId);
        chatsChanged();
        const s = useStore.getState();
        s.refreshPages();
        for (const pg of p.pages ?? []) s.bumpExternal(pg.id);
      }
      liveRef.current = next;
      setLive(next);
      return true;
    },
    [load],
  );

  useEffect(() => {
    const un = listen<AiEvent>("worlds://ai", (e) => {
      if (!apply(e.payload)) holdEarly(e.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, [apply]);

  const setChatId = useCallback((id: string | null) => {
    setChatIdState(id);
    writeLastChat(id);
  }, []);

  const send = useCallback(
    async (prompt: string, pageId: string | null, attachments: ChatAttachment[] = [], opts: { newChat?: boolean } = {}) => {
      // A previous failure must not block the next message; only a run in progress does.
      if ((!prompt.trim() && !attachments.length) || liveRef.current?.status === "running") return;
      const text = prompt.trim() || (attachments.length === 1 ? "Take a look at this file." : "Take a look at these files.");
      const optimistic: AiMessage = { id: `tmp-${Date.now()}`, role: "user", content: text, steps: [], opId: null, meta: { pageId, attachments }, createdAt: Date.now() };
      if (opts.newChat) {
        setMessages([optimistic]);
        setTitle("");
      } else setMessages((m) => [...m, optimistic]);
      try {
        // Mark the run as starting so a double Enter cannot send twice.
        liveRef.current = { runId: "", steps: [], status: "running" };
        setLive(liveRef.current);
        const { runId, chatId: cid } = await api.aiRun({ prompt: text, pageId, chatId: opts.newChat ? null : chatId, attachments: attachments.map((a) => a.id) });
        liveRef.current = { runId, steps: [], status: "running" };
        setLive(liveRef.current);
        // Events that raced ahead of the run id.
        const held = early.get(runId);
        early.delete(runId);
        for (const ev of held?.events ?? []) apply(ev);
        if (cid !== chatId) {
          setChatId(cid);
          chatsChanged();
        }
      } catch (e) {
        liveRef.current = { runId: "", steps: [], status: "error", error: errorMessage(e) };
        setLive(liveRef.current);
      }
    },
    [chatId, setChatId, apply],
  );

  const stop = useCallback(async () => {
    const cur = liveRef.current;
    if (!cur) return;
    try {
      if (cur.runId) await api.aiCancel(cur.runId);
    } catch (e) {
      useStore.getState().toast({ message: `Could not stop Claude: ${errorMessage(e)}`, tone: "error" });
    }
    liveRef.current = null;
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
