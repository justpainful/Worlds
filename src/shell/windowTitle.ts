import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/api";
import { tr } from "../i18n/ui";
import { useStore } from "../state/store";
import { routeLabel } from "./Panes";

/** The window title for a tab label: "Weekly plan · Worlds", or "Worlds" with nothing open. */
export function windowTitle(label: string): string {
  const name = label.trim();
  return name ? `${name} · Worlds` : "Worlds";
}

/**
 * The taskbar and Alt+Tab name the open page, as Windows apps do, instead of
 * every Worlds window reading just "Worlds".
 */
export function useWindowTitle(): void {
  const label = useStore((s) => {
    const pane = s.layout.panes.find((p) => p.id === s.layout.activePaneId);
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId);
    return tab ? routeLabel(tab.route, s.pages).title : "";
  });
  const language = useStore((s) => s.profile?.language ?? null);
  useEffect(() => {
    if (!isTauri) return;
    getCurrentWindow()
      .setTitle(windowTitle(tr(label)))
      .catch(() => {});
  }, [label, language]);
}
