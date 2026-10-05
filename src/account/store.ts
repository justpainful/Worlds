import "./devMock";
import { useMemo } from "react";
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { errorMessage, isTauri } from "../lib/api";
import type { PageMeta } from "../lib/types";
import { useStore } from "../state/store";
import { accountApi, type AccountView, type Workspace } from "./api";
import { scopePages, workspaceOf } from "./scope";

export type Sheet =
  | { kind: "signin"; start?: "choose" | "create" | "signin" }
  | { kind: "share"; pageId: string }
  | { kind: "members"; workspaceId: string }
  | { kind: "create" }
  | { kind: "join"; link?: string }
  | null;

interface AccountStore {
  view: AccountView | null;
  /** Page id to Team workspace id, for pages outside Personal. */
  pageWs: Record<string, string>;
  fetchedAt: number;
  sheet: Sheet;
  load: () => Promise<void>;
  apply: (v: AccountView) => void;
  open: (s: Sheet) => void;
  close: () => void;
  /** Run an account action; errors become a toast and resolve to undefined. */
  run: <T>(fn: () => Promise<T>, done?: string) => Promise<T | undefined>;
}

export const useAccount = create<AccountStore>((set) => ({
  view: null,
  pageWs: {},
  fetchedAt: 0,
  sheet: null,
  load: async () => {
    if (!isTauri) return;
    try {
      const [view, pageWs] = await Promise.all([accountApi.state(), accountApi.pageWorkspaces()]);
      set({ view, pageWs, fetchedAt: Date.now() });
    } catch {
      // The account layer is optional: the app works without it.
    }
  },
  apply: (v) => {
    set({ view: v });
    accountApi.pageWorkspaces().then(
      (pageWs) => set({ pageWs, fetchedAt: Date.now() }),
      () => {},
    );
  },
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
  run: async (fn, done) => {
    try {
      const r = await fn();
      if (done) useStore.getState().toast({ message: done, tone: "success" });
      return r;
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
      return undefined;
    }
  },
}));

let started = false;

/** Load once and follow changes from Rust (sync results, other windows). */
export function startAccount() {
  if (started || !isTauri) return;
  started = true;
  const s = useAccount.getState();
  s.load();
  listen("worlds://account", () => useAccount.getState().load()).catch(() => {});
  window.addEventListener("worlds:changed", () => useAccount.getState().load());
  // New or moved pages: refresh which workspace each page is in, and when
  // the shape of a Team tree changed, push it soon (in the background).
  let timer = 0;
  let pushTimer = 0;
  let lastShape = "";
  useStore.subscribe((st, prev) => {
    if (st.pages === prev.pages) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      accountApi.pageWorkspaces().then(
        (pageWs) => {
          useAccount.setState({ pageWs, fetchedAt: Date.now() });
          const pages = useStore.getState().pages;
          const shape = Object.keys(pageWs)
            .sort()
            .map((id) => `${id}:${pages[id]?.parentId ?? ""}:${pageWs[id]}`)
            .join("|");
          if (shape === lastShape) return;
          const first = lastShape === "";
          lastShape = shape;
          if (first || useAccount.getState().view?.status !== "active") return;
          window.clearTimeout(pushTimer);
          pushTimer = window.setTimeout(() => {
            accountApi.sync().then(
              (v) => useAccount.getState().apply(v),
              () => {},
            );
          }, 4000);
        },
        () => {},
      );
    }, 120);
  });
}

/** True when both pages are in the same workspace (moves never cross workspaces). */
export function sameWorkspace(a: string, b: string): boolean {
  const { pageWs, fetchedAt, view } = useAccount.getState();
  const pages = useStore.getState().pages;
  const active = view?.activeWorkspaceId ?? null;
  return workspaceOf(pages, pageWs, fetchedAt, active, a) === workspaceOf(pages, pageWs, fetchedAt, active, b);
}

export function activeWorkspace(v: AccountView | null): Workspace | null {
  if (!v?.activeWorkspaceId) return null;
  return v.workspaces.find((w) => w.id === v.activeWorkspaceId) ?? null;
}

/** The sidebar shows the active workspace only (Personal when none is active). */
export function useWorkspacePages(pages: Record<string, PageMeta>): Record<string, PageMeta> {
  const pageWs = useAccount((s) => s.pageWs);
  const fetchedAt = useAccount((s) => s.fetchedAt);
  const active = useAccount((s) => s.view?.activeWorkspaceId ?? null);
  return useMemo(() => scopePages(pages, pageWs, fetchedAt, active), [pages, pageWs, fetchedAt, active]);
}

export function openShareSheet(pageId: string) {
  useAccount.getState().open({ kind: "share", pageId });
}
