import { useEffect, type ReactNode } from "react";
import { getCurrentWindow, PhysicalPosition, PhysicalSize, availableMonitors } from "@tauri-apps/api/window";
import { api, isTauri } from "../lib/api";
import { useStore } from "../state/store";
import { glassScene } from "../glass/scene";
import { Glass } from "../glass/Glass";
import { LAYER } from "../glass/materials";
import { Icon } from "../ui/Icon";

interface SavedWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  maximized: boolean;
}

/** Restore size/position, then reveal the window (it starts hidden: no flash). */
export async function restoreAndShow() {
  if (!isTauri) return;
  const win = getCurrentWindow();
  let hidden = false;
  try {
    hidden = (await api.launchInfo()).hidden;
    await restoreGeometry();
  } catch (e) {
    console.error("restore window geometry", e);
  }
  if (!hidden) {
    await win.show();
    await win.setFocus();
  }
}

async function restoreGeometry() {
  const win = getCurrentWindow();
  const saved = useStore.getState().settings["window"] as SavedWindow | undefined;
  if (saved && saved.w > 400 && saved.h > 300) {
    const monitors = await availableMonitors();
    const visible = monitors.some((m) => {
      const { x, y } = m.position;
      const { width, height } = m.size;
      return saved.x + 80 > x && saved.x < x + width - 80 && saved.y + 40 > y && saved.y < y + height - 40;
    });
    if (visible) {
      await win.setSize(new PhysicalSize(saved.w, saved.h));
      await win.setPosition(new PhysicalPosition(saved.x, saved.y));
    }
    if (saved.maximized) await win.maximize();
  }
}

export function useWindowState() {
  const setWindowState = useStore((s) => s.setWindowState);
  useEffect(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    let saveTimer = 0;
    const save = async () => {
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(async () => {
        const maximized = await win.isMaximized();
        const minimized = await win.isMinimized();
        if (minimized) return;
        const prev = useStore.getState().settings["window"] as SavedWindow | undefined;
        if (maximized) {
          if (prev) useStore.getState().setSetting("window", { ...prev, maximized: true });
          return;
        }
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        useStore.getState().setSetting("window", { x: pos.x, y: pos.y, w: size.width, h: size.height, maximized: false });
      }, 500);
    };
    const sync = async () => {
      const max = await win.isMaximized();
      setWindowState(useStore.getState().windowActive, max);
      glassScene.invalidate();
    };
    const unsubs: Promise<() => void>[] = [
      win.onResized(() => {
        sync();
        save();
      }),
      win.onMoved(() => save()),
      win.onFocusChanged(({ payload }) => {
        setWindowState(payload, useStore.getState().maximized);
        glassScene.setActive(payload);
      }),
    ];
    sync();
    return () => {
      unsubs.forEach((u) => u.then((f) => f()));
    };
  }, [setWindowState]);
}

/** Things that must keep their own click behaviour inside a drag zone. */
const INTERACTIVE =
  'button, a, input, textarea, select, label, [contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"], [draggable="true"], .no-drag';

/**
 * Window dragging from any empty chrome. Any element inside a
 * `[data-drag-zone]` that is not itself interactive moves the window
 * (native move loop: Snap, multi-monitor and per-monitor DPI all work);
 * double-click maximises or restores.
 */
function useDragZones() {
  useEffect(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.("[data-drag-zone]") || t.closest(INTERACTIVE)) return;
      e.preventDefault();
      if (e.detail === 2) win.toggleMaximize();
      else win.startDragging();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);
}

export function WindowFrame({ children }: { children: ReactNode }) {
  const maximized = useStore((s) => s.maximized);
  const active = useStore((s) => s.windowActive);
  useWindowState();
  useDragZones();
  return (
    <div className={`window ${maximized ? "is-maximized" : ""} ${active ? "" : "is-inactive-window"}`}>
      <div className="frame">{children}</div>
    </div>
  );
}

export function WindowControls() {
  const maximized = useStore((s) => s.maximized);
  if (!isTauri) return null;
  const win = getCurrentWindow();
  return (
    <Glass material="clear" layer={LAYER.floating} className="win-controls" radius="var(--r-capsule)">
      <div className="win-controls-row">
        <button className="win-btn" aria-label="Minimize" onClick={() => win.minimize()}>
          <Icon name="minimize" size={14} />
        </button>
        <button className="win-btn" aria-label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
          <Icon name={maximized ? "unmaximize" : "maximize"} size={maximized ? 13 : 12} />
        </button>
        <button className="win-btn win-close" aria-label="Close" onClick={() => win.close()}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </Glass>
  );
}
