# Frontend audit for Apple native port

Audit date: 2026-11-07. Source: `original local checkout`, HEAD `185ee9a1019c8b7bc685d22dabf1b699579189cc` plus its working-tree changes. This report records source inspection, not verified runtime behavior. It is incomplete: it does not claim that every source file, UI state, backend path, test, or platform behavior has been reviewed. No application builds, live services, or visual checks were run for this report. Implementation and test completion for Apple remain unverified.

## Source provenance

The original checkout contains substantial uncommitted changes. The worktree on `feat/native-apple-platforms` starts at the same HEAD but does not automatically include them. The following audited files are modified in the original: `src/lib/api.ts`, `src/resources/create.tsx`, `src/shell/CommandPalette.tsx`, `src/editor/views/DrawingEmbedView.tsx`, numerous `src/drawing` modules including `DrawingView.tsx`, `Stage.tsx`, `BrushSettings.tsx`, `recognition.ts`, `renderer.ts`, `session.ts`, `transport.ts`, `preferences.ts`, and `src-tauri/src/lib.rs`. `src/drawing/ScreenDrawing.tsx`, `src/drawing/screenDrawing.css`, and `src-tauri/src/screen_drawing.rs` are untracked. Screen drawing cannot be assumed to exist on the branch based on HEAD alone. Preserve the original working tree and explicitly reconcile changes after review. Other modified and untracked files exist; inspect `git status --short` in the original checkout for the full live list.

## Navigation and content types

`src/views/RouteView.tsx` routes home, resource pages, templates, automations, settings, profile, activity, integrations, trash, material playground, and chat. `src/resources/views/ResourceView.tsx` dispatches resources by kind. `src/resources/kinds.ts` defines page, document, presentation, drawing, project, gallery, file, and stream; creation offers the first six. Templates are separate page records. An Apple implementation needs navigation and behavior for the actual kinds, not an assumed fixed set of placeholder screens.

`src/views/HomeView.tsx` reads automations and instantiates templates. `TemplatesView.tsx` creates, instantiates, duplicates, and deletes templates. `TrashView.tsx` restores and purges pages, and can unarchive items. `ActivityView.tsx` displays history and pending actions and resolves approvals. `Inspector.tsx` retrieves history and versions, invokes operation undo and version restoration, and edits assistant instructions. `AutomationsView.tsx` lists, edits, runs, and deletes automations and reads run history. `IntegrationsView.tsx` retrieves AI and Discord status and Discord destinations. `SettingsView.tsx` includes language, text direction, appearance, AI setup and backups. These are source-level observations, not a complete inventory of their controls or permission rules.

## Pages and documents

`src/views/PageView.tsx` loads page data through `api.page`, updates metadata and title, and supports page properties. `src/editor/PageEditor.tsx` and its extensions implement rich blocks. `src/editor/slashItems.ts` inserts paragraphs, headings, lists, checklists, callouts, code blocks, tables, dividers, child pages, references, two or three columns, collapsible sections, collection table, board, gallery, table of contents, media, embeds, equations, diagrams, charts, tabs, and AI actions. Data and editor behavior must be traced through the block schema and save/mirror paths before selecting a native text editing architecture.

`src/editor/views/Pages4Views.tsx` renders LaTeX through KaTeX and Mermaid code through Mermaid. `src/editor/views/FilePreview.tsx` loads SheetJS for spreadsheet preview and `docx-preview` for Word preview. These observations do not establish full XLSX or DOCX editing, importing, or exporting. `src/resources/views/DocumentView.tsx` is a distinct document view and needs a further interaction and persistence audit.

## Resource editors

`src/resources/views/PresentationView.tsx` implements a slide editor with navigator, canvas, notes, present mode, local undo/redo, and slide data converted to and from blocks in `src/resources/deck/model.ts`. `ProjectView.tsx` holds project status, dates, description and linked resources, combines linked and child resources, and requests history. `GalleryView.tsx` imports files and saves gallery blocks through `api.importFile` and `api.saveBlocks`. `FileView.tsx` opens attachment-backed content and uses the OS to reveal a file. `StreamView.tsx` loads HLS.js for supported streams. Import/export parity and every gesture in these views remain to be established by detailed tracing.

## Drawing

The source contains an extensive drawing implementation; the inspected current files include uncommitted work. `src/drawing/model.ts` defines drawing schema 1, frame/layer/node/asset/mask/step collections, paint, effects, text formatting, pressure and tilt samples, blend modes, and drawing operations. Preserve this schema and attachment references, or provide a verified migration with round-trip behavior.

`src/drawing/Stage.tsx` declares select, brush, eraser, highlighter, laser, shape, text, eyedropper, fill, selection, and redaction tools. `brushConfig.ts` lists 13 brush kinds. `BrushSettings.tsx` allows laser lifetime from 0.2 to 4 seconds; `Stage.tsx` constructs a laser stroke with the selected brush color and size. `recognition.ts` includes confidence-gated shape recognition and right triangle projection. `DrawingView.tsx` integrates editing and saving, while other drawing modules cover masks, pixel selections, image processing, layer merging, references, library publishing, exports, and collaboration. Module presence does not establish that all interactions work.

`DrawingView.tsx` invokes `capture_screen_for_drawing` and `end_screen_drawing`; the current `ScreenDrawing.tsx` provides tools over a captured screen. Both the UI and backend screen-capture implementation have uncommitted or untracked changes. Apple screen capture, display selection, permission prompts, and drawing on a captured frame need platform-specific implementation and explicit device validation. The existing code must not be described as a verified Apple implementation.

`DrawingView.tsx` and `renderer.ts` explicitly reject export when unsupported vector or text effects are active. `svg.ts` restricts SVG input to static content without external references or CSS. These are current implementation limitations, not proof that all effect and SVG operations fail.

## Collaboration and storage boundaries

`src/sync/useCollab.tsx` separates personal block saving from shared Yjs sessions, creates collaboration extensions after session readiness, enforces editability from session rights, exposes a stable editor wrapper, and flushes shared changes through a mirror. `src/sync/session.ts`, `provider.ts`, `protocol.ts`, `mirror.ts`, `comments.ts`, and associated UI require further protocol and conflict analysis. A direct REST-only replacement would not by itself prove Yjs compatibility, awareness, access enforcement, or offline convergence.

The UI invokes Tauri commands through `src/lib/api.ts` for page CRUD, save blocks with base version, search, history, versions, attachments, templates, settings and session state. Attachment URLs use a local `wfile` protocol. API calls, schemas, storage formats, and server protocols require tracing into Rust and services before a shared Apple core can promise compatibility.

## AI and external integrations

`src/ai/chat/useChat.tsx` loads chat records, starts `api.aiRun`, handles tool events, streamed text, completion, errors and cancellation state, and listens for `worlds://ai` Tauri events. `src/lib/api.ts` exposes AI chat CRUD, run, cancel, status, MCP registration and token operations via Tauri IPC. The source documents a Windows Credential Manager token path. A SwiftUI app requires an actual supported service and credential path; a mock conversation is not parity. Determine Claude runtime availability and service contracts separately on each Apple platform.

`ActivityView.tsx` and `src/lib/api.ts` contain a pending-action approval flow and Discord rendering and send calls. This evidence does not authorize sending messages during audit. Preserve approval boundaries and verify execution against isolated accounts when tests are available.

## Dependencies and portability

`package.json` declares Tiptap, Yjs, Mermaid, KaTeX, SheetJS, docx-preview, HLS.js, Three.js, dxf-parser and occt-import-js. Imports of Mermaid, KaTeX, SheetJS, docx-preview and HLS were located in the frontend. A targeted search did not locate imports of Three.js, dxf-parser or occt-import-js under `src`; this is not proof that no other part of the repository uses them. Do not count CAD or 3D as verified features from dependency declarations alone.

## Remaining audit work

1. Compare each changed original source file with HEAD and identify behavior that is absent from the Apple branch.
2. Trace every resource, editor command and settings action through IPC, Rust persistence, server protocol, authorization and error handling.
3. Enumerate every screen, responsive state, localization string and accessibility behavior from running builds and source.
4. Trace actual attachment formats, import/export paths, collaborative conflict handling, AI execution and scheduled jobs with isolated data.
5. Inspect existing tests and live behavior before assigning any feature the status Existing and Verified. This report does not provide a feature completion percentage.
