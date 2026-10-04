import { openUrl } from "@tauri-apps/plugin-opener";
import { emit } from "../lib/bus";
import { useStore } from "../state/store";
import { useMenu, type MenuItem } from "../ui/Menu";
import { openLightbox } from "../editor/views/Pages3Views";

/**
 * Worlds' own right-click menu. The WebView's built-in menu (Back, Reload,
 * Print, Inspect...) never appears; instead each place gets the few actions
 * that make sense there. Components with their own menus (sidebar rows,
 * blocks) call preventDefault first and are left alone.
 */

type Saved =
  | { kind: "input"; el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number }
  | { kind: "rich"; el: HTMLElement; range: Range | null }
  | null;

function restore(saved: Saved) {
  if (!saved) return;
  saved.el.focus();
  if (saved.kind === "input") saved.el.setSelectionRange(saved.start, saved.end);
  else if (saved.range) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(saved.range);
  }
}

const toast = (message: string) => useStore.getState().toast({ message });

async function copyImage(src: string) {
  try {
    const blob = await (await fetch(src)).blob();
    const png = blob.type === "image/png" ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast("Image copied");
  } catch {
    toast("This image could not be copied");
  }
}

async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  return new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error("png"))), "image/png"));
}

function saveImage(src: string, name: string) {
  const a = document.createElement("a");
  a.href = src;
  a.download = name || "image";
  a.click();
}

export function installContextMenu(): () => void {
  const onCtx = (e: MouseEvent) => {
    if (e.defaultPrevented) return; // a component showed its own menu
    e.preventDefault();
    const t = e.target as HTMLElement;
    const show = useMenu.getState().show;
    const items: MenuItem[] = [];

    const field = t.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
    const rich = t.closest("[contenteditable='true']") as HTMLElement | null;
    const editable = (!!field && !field.readOnly && !field.disabled && !["checkbox", "radio", "range", "color", "button"].includes((field as HTMLInputElement).type)) || !!rich;
    const selText = field ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0) : window.getSelection()?.toString() ?? "";
    const saved: Saved = field
      ? { kind: "input", el: field, start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 }
      : rich
        ? { kind: "rich", el: rich, range: window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null }
        : null;

    const link = t.closest("a[href]") as HTMLAnchorElement | null;
    const img = t.closest("img") as HTMLImageElement | null;

    if (link && /^https?:/.test(link.href)) {
      items.push(
        { label: "Open Link", icon: "openExternal", onSelect: () => openUrl(link.href) },
        { label: "Copy Link", icon: "link", onSelect: () => navigator.clipboard.writeText(link.href).then(() => toast("Link copied")) },
        { kind: "separator" },
      );
    }
    if (img && img.src && !img.closest(".avatar, .product-icon, .ref-icon-img")) {
      items.push(
        { label: "View Full Screen", icon: "expand", onSelect: () => openLightbox([{ attachmentId: "", name: img.alt || "", src: img.src }], 0) },
        { label: "Copy Image", icon: "duplicate", onSelect: () => copyImage(img.src) },
        { label: "Save Image", icon: "download", onSelect: () => saveImage(img.src, img.alt) },
        { kind: "separator" },
      );
    }

    if (editable) {
      items.push(
        { label: "Cut", shortcut: "Ctrl+X", disabled: !selText, onSelect: () => (restore(saved), document.execCommand("cut")) },
        { label: "Copy", shortcut: "Ctrl+C", disabled: !selText, onSelect: () => (restore(saved), document.execCommand("copy")) },
        {
          label: "Paste",
          shortcut: "Ctrl+V",
          onSelect: async () => {
            const text = await navigator.clipboard.readText().catch(() => "");
            restore(saved);
            if (text) document.execCommand("insertText", false, text);
          },
        },
        { label: "Select All", shortcut: "Ctrl+A", onSelect: () => (restore(saved), field ? field.select() : document.execCommand("selectAll")) },
      );
    } else if (selText.trim()) {
      items.push({ label: "Copy", shortcut: "Ctrl+C", onSelect: () => navigator.clipboard.writeText(selText).then(() => toast("Copied")) });
    }

    if (selText.trim()) {
      const quoted = selText.trim().slice(0, 2000);
      items.push(
        { kind: "separator" },
        { label: "Ask Claude About This", icon: "assistant", onSelect: () => emit("ai:open", { pageId: null, prompt: `About this:\n"""\n${quoted}\n"""\n` }) },
        { label: "Search Worlds", icon: "search", onSelect: () => useStore.getState().setPalette(true, "all") },
      );
    }

    if (!items.length) {
      items.push(
        { label: "New Page", icon: "add", shortcut: "Ctrl+N", onSelect: () => useStore.getState().createPage({}, "current") },
        { label: "Search and Commands", icon: "search", shortcut: "Ctrl+K", onSelect: () => useStore.getState().setPalette(true, "all") },
        { label: "Ask Claude", icon: "assistant", shortcut: "Ctrl+J", onSelect: () => window.dispatchEvent(new Event("worlds:toggle-ai")) },
      );
    }
    // Trim a trailing separator.
    while (items.length && (items[items.length - 1] as { kind?: string }).kind === "separator") items.pop();
    show(e.clientX, e.clientY, items);
  };
  window.addEventListener("contextmenu", onCtx);
  return () => window.removeEventListener("contextmenu", onCtx);
}
