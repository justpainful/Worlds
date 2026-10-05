import { create } from "zustand";
import type { Anchor } from "../comments";

/** Which page's comments are showing, which thread is active, and a draft. */
interface CommentsUi {
  pageId: string | null;
  active: string | null;
  draft: { pageId: string; anchor: Anchor; quote: string } | null;
  showResolved: boolean;
  open: (pageId: string) => void;
  openThread: (pageId: string, threadId: string) => void;
  startDraft: (pageId: string, anchor: Anchor, quote: string) => void;
  clearDraft: () => void;
  close: () => void;
  toggleResolved: () => void;
}

export const useCommentsUi = create<CommentsUi>((set) => ({
  pageId: null,
  active: null,
  draft: null,
  showResolved: false,
  open: (pageId) => set({ pageId }),
  openThread: (pageId, threadId) => set({ pageId, active: threadId }),
  startDraft: (pageId, anchor, quote) => set({ pageId, draft: { pageId, anchor, quote }, active: null }),
  clearDraft: () => set({ draft: null }),
  close: () => set({ pageId: null, active: null, draft: null }),
  toggleResolved: () => set((s) => ({ showResolved: !s.showResolved })),
}));
