import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/**
 * Editor shortcuts on keys that type more than one character. On the Arabic
 * layout the B key types "لا", so Ctrl+B reaches the editor as Ctrl+لا, which
 * neither the shortcut table nor ProseMirror's single character fallback
 * understands. Such a press is replayed once as its physical Latin letter.
 */
export const LayoutShortcuts = Extension.create({
  name: "layoutShortcuts",
  priority: 1000,
  addProseMirrorPlugins() {
    let replaying = false;
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (replaying || !(event.ctrlKey || event.metaKey)) return false;
            if (event.key.length < 2 || /^[\x20-\x7e]+$/.test(event.key)) return false;
            const physical = /^Key([A-Z])$/.exec(event.code);
            if (!physical) return false;
            const letter = physical[1];
            const latin = new KeyboardEvent("keydown", {
              key: event.shiftKey ? letter : letter.toLowerCase(),
              code: event.code,
              keyCode: letter.charCodeAt(0),
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
              altKey: event.altKey,
            });
            replaying = true;
            try {
              const handled = view.someProp("handleKeyDown", (f) => f(view, latin)) ?? false;
              if (handled) event.preventDefault();
              return handled;
            } finally {
              replaying = false;
            }
          },
        },
      }),
    ];
  },
});
