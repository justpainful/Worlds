import { createRoot } from "react-dom/client";
import { PagePicker } from "../ai/chat/Composer";

/**
 * Ask for a page with the same picker the Claude composer uses. Resolves with
 * the page id, or null when the picker closes without a choice.
 */
export function choosePage(anchor: DOMRect | HTMLElement): Promise<string | null> {
  const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const done = (id: string | null) => {
      if (settled) return;
      settled = true;
      // Let the picker's own close animation finish before tearing it down.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(id);
    };
    root.render(<PagePicker anchor={rect} onPick={(id) => done(id)} onClose={() => done(null)} />);
  });
}
