import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage, isTauri } from "./lib/api";
import { useStore } from "./state/store";
import { WindowFrame, restoreAndShow } from "./shell/Window";
import { Sidebar } from "./shell/Sidebar";
import { Panes } from "./shell/Panes";
import { CommandPalette } from "./shell/CommandPalette";
import { MenuHost } from "./ui/Menu";
import { Toasts, TooltipHost } from "./ui/misc";
import { glassScene } from "./glass/scene";
import { applyAppearance } from "./shell/appearance";
import { AiHost } from "./ai/AiPanel";
import { LightboxHost } from "./editor/views/Pages3Views";
import { installContextMenu } from "./shell/ContextMenu";
import { AutomationHost } from "./automations/AutomationEditor";

export function App() {
  const ready = useStore((s) => s.ready);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) {
      setError("Worlds runs as a desktop app. Start it with `pnpm app:dev`.");
      return;
    }
    useStore
      .getState()
      .init()
      .then(() => applyAppearance())
      .catch((e) => setError(errorMessage(e)))
      // The window starts hidden to avoid a flash; it must always be revealed.
      .finally(() => restoreAndShow());
  }, []);

  useEffect(() => {
    if (!ready) return;
    const unsubs: Promise<() => void>[] = [];
    // Writes from the MCP tool server or the automation runner.
    unsubs.push(
      listen<{ pageId: string | null; kind: string; origin: string }[]>("worlds://changed", (e) => {
        const s = useStore.getState();
        let pages = false;
        let pending = false;
        for (const c of e.payload) {
          if (c.pageId) s.bumpExternal(c.pageId);
          if (c.kind === "page" || c.kind === "tree" || c.kind === "blocks") pages = true;
          if (c.kind === "pending") pending = true;
          if (c.kind === "profile") api.profile().then(s.setProfile);
        }
        if (pages) s.refreshPages();
        if (pending) refreshPending();
        window.dispatchEvent(new CustomEvent("worlds:changed", { detail: e.payload }));
      }),
    );
    unsubs.push(
      listen<{ automation: string }>("worlds://approval", (e) => {
        refreshPending();
        useStore.getState().toast({ message: `“${e.payload.automation}” is ready to send and needs your approval.` });
      }),
    );
    refreshPending();
    return () => unsubs.forEach((u) => u.then((f) => f()));
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const pane = s.layout.panes.find((p) => p.id === s.layout.activePaneId)!;
      const tab = pane.tabs.find((t) => t.id === pane.activeTabId)!;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setPalette(!s.paletteOpen, "all");
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        s.setPalette(true, "commands");
      } else if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        s.setPalette(true, "pages");
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        s.createPage({}, e.shiftKey ? "right" : "current");
      } else if (mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        s.open({ kind: "home" }, "tab");
      } else if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        s.closeTab(pane.id, tab.id);
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        if (e.shiftKey || s.layout.panes.length >= 3) s.collapsePanes();
        else s.open(tab.route, "right");
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        window.dispatchEvent(new Event("worlds:toggle-ai"));
      } else if (mod && e.key === ",") {
        e.preventDefault();
        s.open({ kind: "settings" }, "tab");
      } else if (mod && e.key === "Tab") {
        e.preventDefault();
        const i = pane.tabs.findIndex((t) => t.id === pane.activeTabId);
        const n = pane.tabs[(i + (e.shiftKey ? -1 : 1) + pane.tabs.length) % pane.tabs.length];
        s.activateTab(pane.id, n.id);
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        s.goBack(pane.id);
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        s.goForward(pane.id);
      } else if (mod && /^[1-3]$/.test(e.key) && e.altKey) {
        const p = s.layout.panes[Number(e.key) - 1];
        if (p) s.focusPane(p.id);
      }
    };
    window.addEventListener("keydown", onKey);
    // Ctrl+B / Ctrl+\ sidebar handled here so editors can still use Ctrl+B for bold.
    const onSidebar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        useStore.getState().toggleSidebar();
      }
    };
    window.addEventListener("keydown", onSidebar);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onSidebar);
    };
  }, [ready]);

  // Worlds' own right-click menu everywhere; the WebView's built-in one never shows.
  useEffect(() => installContextMenu(), []);

  useEffect(() => {
    glassScene.init();
  }, []);

  if (error) {
    return (
      <div className="boot-error">
        <p>{error}</p>
      </div>
    );
  }
  if (!ready) return null;

  return (
    <WindowFrame>
      <Sidebar />
      <main className="main">
        <Panes />
      </main>
      <CommandPalette />
      <MenuHost />
      <Toasts />
      <TooltipHost />
      <AiHost />
      <LightboxHost />
      <AutomationHost />
    </WindowFrame>
  );
}

export function refreshPending() {
  api
    .pending()
    .then((p) => useStore.getState().setPendingCount(p.length))
    .catch(() => {});
}
