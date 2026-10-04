# Worlds v0.1 Daily Driver Alpha

Stabilize and polish the foundation before collaboration, cloud or new content types.

## Done

**Liquid Glass**
- Real refraction works in WebView2. The engine had been silently flat, because Chromium blanks an SVG `backdrop-filter` under any transformed ancestor. Lift and scale now move the layers, and nested or transformed glass takes the CSS path.
- Every floating control that used a plain CSS blur now uses the engine: page find bar, sticky title, status bar, cover actions, page header over covers, profile buttons, profile edit bar, slide navigation and lightbox bar.
- Light glass flips every ink and fill level. Tinting is local to the colour under the glass, and mid-tone backdrops get a denser body.

**Performance**
- Off-screen glass skips its backdrop pass.
- Slow frames step Full down to Reduced automatically.
- Idle sampling is slower, and navigation resamples immediately.
- The thumbnail cache is bounded.
- Launch does a cheap readability check; the full integrity check runs in the background.
- Developer performance overlay (Settings > Advanced).

**Pages**
- Edits survive fast navigation, editor teardown, two panes on one page, quitting from the tray and Claude writing while you type. A save is refused if the page changed since the editor last synced, then the editor merges and saves again.
- The placeholder hint can no longer abort editor updates (this fixed undo/redo after toggles, columns and tables).
- Slash search ignores punctuation, and each slash item has a unique id.
- Pasted files use raw binary IPC.

**Claude**
- Run events that arrive early are held and replayed, so nothing is lost and runs never get stuck.
- Errors no longer block the next message, a double Enter cannot send twice, and drafts are kept per conversation.

**Safety net**
- SQLite backups: before migrations, daily and on demand. Restore applies at the next launch, and a damaged database is recovered automatically.
- 22 Rust tests: migrations, saving, duplicate ids, history, versions, undo, conflicts, backups and name cleaning.
- 9 Vitest tests: block merge, link and file safety.
- GitHub Actions runs typecheck, tests, the production build, rustfmt, clippy and cargo test.

**Security**
- Content Security Policy.
- Only web, mail and Discord links open, and programs or scripts are revealed instead of launched.
- The opener is scoped to Worlds data.
- Claude may attach only personal media and documents.
- Attachment names, extensions and sizes are validated, and `wfile` never executes markup or lets the browser sniff types.

**Architecture** (no behaviour change)
- `store.rs` split into 7 domain modules.
- MCP handlers split into 5 domain modules.
- `chat.tsx` split into 6 modules and `ProfileView.tsx` into 5.
- `views.css` split per view.

## Still to verify on the real app
- Window transparency (Glass mode) after the body fix.
- A real Discord send through the renamed bridge.
- Hover and press feel of the moved glass transforms.
