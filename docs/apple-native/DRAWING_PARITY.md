# Drawing parity audit

Snapshot: 2026-11-07, original checkout `original local checkout`, HEAD `185ee9a1019c8b7bc685d22dabf1b699579189cc` plus uncommitted and untracked changes. The Apple branch starts at the same HEAD without those changes. In particular, `DrawingView.tsx`, `Stage.tsx`, `BrushSettings.tsx`, `recognition.ts`, `renderer.ts`, `session.ts`, `transport.ts` and many supporting modules are modified; `ScreenDrawing.tsx` and `src-tauri/src/screen_drawing.rs` are untracked. Consult the original checkout's `git status --short` and diffs before treating any behavior as committed source.

This is a partial, source-based inventory, not a complete acceptance matrix. Status **Source observed** means implementation was located, not that it was executed, tested, or visually verified. Status **Needs investigation** means evidence is incomplete. Apple status is **Not verified** for every row; no native implementation or test result is inferred. Checks describe future acceptance criteria, not tests performed.

## Persistent model and editing

| Feature | Source observation and evidence | Source status | Apple acceptance criteria |
| --- | --- | --- | --- |
| Document model | `src/drawing/model.ts:5-8,108-140` defines schema 1, scene collections, ordered entities and edit/toggle operations. Limits include 16,384 pixels per side and 64 million pixels per frame. | Source observed | Decode actual documents without losing entities or operation history; demonstrate a reversible round trip. |
| Frames | `model.ts:30-36,108-115` stores size, background, clip, status, export scale, guides and grid. | Source observed | Edit and persist each field and multiple frame ordering. |
| Layers | `model.ts:37-42` stores visibility, locks, opacity, parent and six blend modes; `layers.ts`, `layerMerge.ts` implement supporting operations. | Source observed | Preserve hierarchy, locks, blending and merge outcomes. |
| Nodes and assets | `model.ts:43-50,73-95` stores image originals, orientation, transforms, object attributes and references. | Source observed | Preserve attachment ownership, images, transforms, metadata and ordering. |
| Text | `model.ts:59-64,75-95` records font, size, weight, italic, alignment, direction, rotation and resize behavior. `TextInspector.tsx` provides controls. | Source observed | Verify text edit, size, weight, italic, rotation and RTL while preserving saved format. |
| Effects and masks | `model.ts:65-68,97-101` records adjustment effects and mask strokes; `MaskDialog.tsx`, `maskRaster.ts` contain editing and raster support. | Source observed | Render and edit supported effects and masks with equivalent results; surface unsupported cases. |
| Paths and shapes | `model.ts:12-13,73` enumerates vector path geometry and shapes including right triangle, arrows and callouts; `PathDialog.tsx` contains path editing UI. | Source observed | Preserve geometry, control points, styling and transformations. |
| Undo and recovery | `session.ts:8-17,64,115,163` tracks pending operations, recovery and save errors. `model.ts:125-140` defines operation history. | Source observed | Preserve pending edits across interruption, avoid silent overwrite and support intended undo semantics. |
| Presentation steps | `model.ts:102-106` stores frame, camera, hidden objects, transitions, duration and pinned version; `Steps.tsx` contains related UI. | Source observed | Open, edit and present saved steps without dropping fields. |

## Tools and interactions

| Feature | Source observation and evidence | Source status | Apple acceptance criteria |
| --- | --- | --- | --- |
| Tool set | `Stage.tsx:28` lists select, brush, eraser, highlighter, laser, shape, text, eyedropper, fill, selection and redact. | Source observed | Each tool must operate through touch, pointer or Pencil as appropriate. |
| Brushes | `brushConfig.ts` lists 13 brush kinds; `model.ts:15-29` defines pressure, opacity, flow, hardness, spacing, smoothing, taper and color. | Source observed | Compare strokes, input pressure and saved settings with original data. |
| Highlighter | `BrushSettings.tsx` selects marker or chisel highlighter and settings. `renderer.ts` includes uniform stroke handling. | Source observed | Verify tip, color, opacity and overlap in drawing and export. |
| Laser | `BrushSettings.tsx:59` exposes a 0.2-4 second fade setting; `Stage.tsx:305` creates a stroke using brush color, size and opacity. | Source observed | Verify color, timing and non-persistent behavior locally and in shared sessions. |
| Shape recognition | `recognition.ts` applies confidence gating to line and closed contours and projects near-right triangles to perpendicular edges. | Source observed | Verify recognized shapes and rejection of unrelated freehand strokes. |
| Pixel selection | `pixelSelection.ts`, `SelectionControls.tsx` and `Stage.tsx:296-302,331-366` include region modes with magic, polygon and lasso paths. | Source observed | Verify boundary, replace/add/subtract behavior and edits against source implementation. |
| Screen drawing | Modified `DrawingView.tsx:405,554` invokes capture and cleanup; untracked `ScreenDrawing.tsx` supplies screen drawing UI and untracked `src-tauri/src/screen_drawing.rs` supports it. | Source observed in uncommitted/untracked files | Establish feasible platform behavior and permissions; capture, draw, close and preserve intended content. |
| Navigation and transforms | `Stage.tsx` has pan, selection, movement, handles, rotation and wheel handling; `TransformDialog.tsx` provides transform UI. | Source observed | Verify touch, mouse, Pencil, keyboard, zoom, pan, object and group transforms. |
| Image tools | `ImageCropDialog.tsx`, `imageCrop.ts`, `rasterizeImage.ts`, `imageIngest.ts`, `imageHeaders.ts` contain crop, image intake and processing paths. | Source observed | Preserve source and edits, orientation, limits and failure handling. |

## Input and output

| Feature | Source observation and evidence | Source status | Apple acceptance criteria |
| --- | --- | --- | --- |
| Image export | `ExportDialog.tsx:17,34-36` selects PNG, JPEG, WebP, BMP and SVG; `renderer.ts` generates frame images. | Source observed | Export actual output for each supported format, compare dimensions, transparency, content and colors. |
| SVG output | `ExportDialog.tsx:35-36` passes a rendered PNG to `flattenedSvg`; `svg.ts` describes restricted static SVG handling. | Source observed | Preserve the actual flattened output semantics; do not claim editable vector export. |
| Batch and annotations | `ExportDialog.tsx:34` invokes `exportFrameArchive` and `exportAnnotatedArchive` in `frameArchive.ts`. | Source observed | Verify selected frames, annotations, names and contents of archives. |
| Project package | `ExportDialog.tsx:36` uses `createDrawingPackage` with optional preview, history and experiments. `PackageImportDialog.tsx:23-31` handles `.worldsdraw`, replacement and independent import paths. | Source observed | Round trip actual packages, attachments and selected history/experiments; verify replacements are recoverable. |
| Clipboard | `files.ts:30-32` writes PNG via Clipboard API after export access checks. | Source observed | Copy and paste across native apps without bypassing access policy. |
| Export permissions | `exportPolicy.ts:2-14` distinguishes images, projects and comments with required access levels. `files.ts` calls export checks before save/copy. | Source observed | Verify checks against real server authority and revocation, not UI state alone. |
| File limits | `files.ts:15-16` rejects empty or over 256 MiB export. `imageHeaders.ts` and `PixelSelectionActions.tsx` include format and dimension validation. | Source observed | Preserve defensible limits and understandable errors; independently inspect all import formats. |
| Vector effect export | `renderer.ts:49,136-137` and `DrawingView.tsx:398-426` block export for unsupported vector/text effects. | Source observed limitation | Reproduce valid existing data safely and clearly report unsupported transformations. |

## Collaboration and shared state

| Feature | Source observation and evidence | Source status | Apple acceptance criteria |
| --- | --- | --- | --- |
| Shared drawing transport | `transport.ts:67-103,180-211` makes authenticated requests to drawing state, operations and leases and distinguishes conflict, denied and offline outcomes. | Source observed | Implement exact service contract and preserve queued edits through reconnection. |
| Revision integrity | `transport.ts:45-61` rejects generation/revision regressions and changed immutable history/dependencies; attachment checks include hashes at line 140. | Source observed | Demonstrate validation with real compatible payloads and failure paths. |
| Gesture leases | `transport.ts:85,193-194` and `gestureLeases.ts` request and track leases for gestures. | Source observed | Verify lease acquisition, expiry, collisions and loss without corrupting edits. |
| Presence and comments | `collaboration.ts` uses awareness and comment state for peers, cursor, camera, selection, laser, following, comment threads, replies and resolution. Permission checks appear at lines 67-72. | Source observed | Verify multi-device presence, comments, authorization and reconnect behavior. |
| Offline and conflict recovery | `session.ts:115,163` preserves recovery state and signals unsaved edits; `transport.ts:176-186` detects conflicting or missing remote state. | Source observed | Demonstrate local recovery and resolution without overwriting user data. |
| Reference and library dependencies | `model.ts:80-95`, `references` and `library` modules contain references and library metadata; `transport.ts` handles dependency state. | Needs investigation | Trace source ownership, update and version rules before implementing compatibility. |

## Outstanding work

Inspect each drawing command end to end into Rust and server handlers, review the changes between committed HEAD and the original working tree, enumerate all dialogs and actual file formats, and run controlled compatibility and visual checks on the original application. Do not count a row as complete based on this document alone.
