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
import { TourHost } from "./shell/Tour";
import { glassEngine } from "./glass/engine";
import { applyAppearance } from "./shell/appearance";
import { AiHost } from "./ai/AiPanel";
import { LightboxHost } from "./editor/views/Pages3Views";
import { installContextMenu } from "./shell/ContextMenu";
import { AutomationHost } from "./automations/AutomationEditor";
import { markReady, startMonitor } from "./perf/monitor";
import { PerfOverlay } from "./perf/PerfOverlay";
import { startDrawingSyncManager } from "./drawing/syncManager";
import { openQuickCapture } from "./planning/InboxView";
import { shortcutKey } from "./lib/keys";
import { watchSampleLanguage } from "./demo/sampleActions";
import { useWindowTitle } from "./shell/windowTitle";
import { useDigests } from "./packs/useDigests";
import { usePublishedImport } from "./packs/published";

export function App() {
  const ready = useStore((s) => s.ready);
  const perfOverlay = useStore((s) => !!s.settings["advanced.perfOverlay"]);
  const [error, setError] = useState<string | null>(null);
  useWindowTitle();
  // Packs whose daily summary is on put what needs attention in Inbox.
  useDigests(ready);
  // Items a teacher or manager sent arrive in this person's own packs.
  usePublishedImport(ready);

  useEffect(() => {
    if (!isTauri) {
      setError("Worlds runs as a desktop app. Start it with `pnpm app:dev`.");
      return;
    }
    useStore
      .getState()
      .init()
      .then(() => {
        applyAppearance();
        markReady();
        startMonitor();
      })
      .catch((e) => setError(errorMessage(e)))
      // The window starts hidden to avoid a flash; it must always be revealed.
      .finally(() => restoreAndShow());
  }, []);

  useEffect(() => {
    if (!ready) return;
    startDrawingSyncManager();
    const unsubs: Promise<() => void>[] = [Promise.resolve(watchSampleLanguage())];
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
      if (mod && shortcutKey(e) === "k") {
        e.preventDefault();
        s.setPalette(!s.paletteOpen, "all");
      } else if (mod && e.shiftKey && shortcutKey(e) === "p") {
        e.preventDefault();
        s.setPalette(true, "commands");
      } else if (mod && shortcutKey(e) === "p") {
        e.preventDefault();
        s.setPalette(true, "pages");
      } else if (mod && e.altKey && shortcutKey(e) === "n") {
        e.preventDefault();
        openQuickCapture();
      } else if (mod && shortcutKey(e) === "n") {
        e.preventDefault();
        s.createPage({}, e.shiftKey ? "right" : "current");
      } else if (mod && shortcutKey(e) === "t") {
        e.preventDefault();
        s.open({ kind: "home" }, "tab");
      } else if (mod && shortcutKey(e) === "w") {
        e.preventDefault();
        s.closeTab(pane.id, tab.id);
      } else if (mod && shortcutKey(e) === "\\") {
        e.preventDefault();
        if (e.shiftKey || s.layout.panes.length >= 3) s.collapsePanes();
        else s.open(tab.route, "right");
      } else if (mod && shortcutKey(e) === "j") {
        e.preventDefault();
        window.dispatchEvent(new Event("worlds:toggle-ai"));
      } else if (mod && shortcutKey(e) === ",") {
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
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && shortcutKey(e) === "l") {
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
    glassEngine.init();
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
      <TourHost />
      <AiHost />
      <LightboxHost />
      <AutomationHost />
      {perfOverlay && <PerfOverlay />}
    </WindowFrame>
  );
}

export function refreshPending() {
  api
    .pending()
    .then((p) => useStore.getState().setPendingCount(p.length))
    .catch(() => {});
}
