# Android and Chromebook input status

The same Android package is used on phones and large windows. The library uses
a two-pane layout at a window width of 840 dp or more. Other screens still need
adaptation. Resize, multi-window and state restoration have not been verified on
a physical Chromebook.

When a personal page owns keyboard focus, Ctrl+F opens Find and Ctrl+H opens
Find and Replace. In local text and code editing dialogs and shared text drafts,
Ctrl+S saves through the same path as the Save button. It does not fire while a
nested dialog is active or a save is in progress. The rich-text and shared
editors also ignore the shortcut during input composition. The shared editor
respects disconnected and missing-snapshot states. Android keyboard shortcut discovery lists the save action while a
supported editor is active. Android 11 and 15 emulator tests exercise these
shortcuts and the discard confirmation. Physical keyboards and ChromeOS shortcut
discovery remain unverified.

In the drawing editor B selects pen, P pencil, H highlighter, E eraser, Ctrl+Z
undo, Ctrl+Shift+Z or Ctrl+Y redo, and Ctrl+0 fits the canvas. The mouse wheel
zooms around the pointer. These are supported only when the drawing surface has
focus and no settings or export dialog is active. See `STYLUS_SUPPORT.md` for
pen and touch limitations.

Physical mouse, trackpad, USI pen, external display and Chromebook multi-window
behavior need device testing. General desktop drag and drop, complete keyboard
navigation and multi-pane layouts for all resources are not implemented.
