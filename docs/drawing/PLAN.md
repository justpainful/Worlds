# Complete Worlds Drawing scope

Authoritative source: the 25-part plan agreed in this chat, plus the eight-feature discussion and goal-objective.md supplied on 2026-11-05. All requirements below remain in scope until verified. Partial implementation is not completion.

## Product and integration

- R01: drawing resource; New menu, blank/canvas size/background, import/open image, paste, template, embedded frame, project/sidebar/search/recent/favorite/archive/trash/duplicate, thumbnail, text/frame/comment indexing.
- R02: context-sensitive tools, remembered tool settings, tooltips/shortcuts, collapsible/resizable persistent panels, narrow-layout inspector, focus mode, accurate brush cursor, zoom/status footer, per-text direction, accessible light/dark UI with neutral artwork surface.
- R03: mixed raster/vector/image/text engine, document coordinates, immutable originals, transforms, masks/effects, operation journal, partial repaint, shared screen/export rendering, worker-heavy work, bounded caches.

## Drawing and image tools

- R04: pencil, hard/soft brush, ink, marker, spray, textured tip. Size 1-2048, opacity, flow, hardness, spacing, angle/roundness, smoothing/stabilization, taper, pressure/mapping curve, reset/save preset. Mouse, optional pen pressure/tilt diagnostics, touch-pan mode, coalesced input, Escape cancel, one undo per stroke.
- R05: eraser to transparency, soft/pressure/opacity erase, selection clipping, mask paint, alpha lock, explicit rasterize-or-mask for vector content. Fill connected/global, tolerance, merged/current sample, edge expansion/contraction, cancelable preview, target layer and selection semantics.
- R06: foreground/background swap, visual picker, HEX/RGB/alpha, current/merged eyedropper, recent/personal/shared palettes, linear/radial multistop gradients, transparent paint, sRGB 8-bit import behavior.
- R07: rectangle/ellipse/lasso/polygon/magic selection, add/subtract/invert/clear/all, grow/shrink/feather. Distinct object/pixel selection. Floating pixels, copy/cut/paste/delete/duplicate, rotate/flip/scale, numeric transforms, align/distribute/group/stack, grid/guides/snapping, original-quality image resampling, preview/cancel.
- R08: line/polyline/editable curve/rect/roundrect/ellipse/triangle/polygon/star/arrows/callout/number/highlight. Fill/stroke/opacity/dashes/endcaps/radius/path editing, proportional drawing, reusable styles.
- R09: editable/searchable bilingual text, bidi/shaping, font/size/weight/align/leading/color/background/border, wrap vs scale, double-click editing, missing-font warning and export appearance, respect font licensing.
- R10: raster/image/text/shape/group/Worlds layers. Add/name/duplicate/reorder/delete/show/hide/lock position/lock alpha/opacity/merge/group/thumbnails/isolate/search. Normal/multiply/screen/overlay/darken/lighten.
- R11: nondestructive crop/rotate/flip/resize, image size vs frame size, brightness/contrast/saturation/temperature/grayscale/invert/blur/sharpen/pixelate, masked effects, effect order/on-off/reset, before-after, explicit reversible rasterization/merge.

## All eight large features

- F01: spacious world canvas, named stable-ID frames with dimensions/background/order/state/default preview/export settings. Single-parent frame membership; world items; move children; duplicate with remapped IDs; crop bounds; resizing distinct from scaling content; minimap; viewport loading; frame/region/batch export.
- F02: linked Worlds page/task/file cards/links/previews/frozen snapshots. Stable source IDs, safe live field updates, layout-affecting update preview, snapshot date, missing-source relink, offline timestamp, region-to-task and return navigation, source permissions checked independently, no leaked restricted preview.
- F03: annotations anchored to point/region/edge/node/world; two-ended arrows; transforms propagate; independent label position; cropped/dangling/deleted-source states; review after image replacement; annotation groups/numbering/status/styles; clean/annotated/both export.
- F04: preserved originals, nondestructive transforms/crop/effects, grayscale masks (paint/fill/gradient/invert/disable/isolate/link/unlink/from selection). Separate opaque redaction and flattened metadata-stripped sanitized image export that carries no hidden originals.
- F05: named experiments with author/base/date/description/state; side-by-side/wipe/difference/linked view comparison; whole/frame/node/property acceptance; explicit conflicts; stable versions; remapped internal anchors; shared immutable assets.
- F06: steps with title/body/camera/frame/zoom/visibility/transitions/optional duration, reorder/duplicate/fixed nodes/preview/fullscreen/keyboard/reduced motion. Draft-follow vs pinned revision. Numbered images, image archive, authorized interactive viewer. Video/audio excluded unless separately requested.
- F07: personal/workspace library of brushes/palettes/shapes/groups/annotation styles/frames/document templates/signatures; name/preview/tags/owner/source/scope/version/dependencies; detached or version-linked insertion; opt-in update; deletion does not break inserted copies; package import/export; rights/font checks; Doti-only characters.
- F08: view/comment/edit/full rights, explicit export policy, presence/cursors/tool/selection/follow/leave-follow/share-location; anchored comment threads/replies/mentions/resolve separate from artwork. Immutable completed strokes, transient previews, authoritative ordering, revision preconditions, explicit conflict recovery, server-validated expiring fenced locks; author-only undo preserving others; offline editing/revalidation/recovery copy/revocation.

## Persistence, I/O and quality

- F09 (owner addition): temporary laser-pointer drawing, smooth fade after release with adjustable lifetime/width/color; ephemeral collaboration presence, never artwork/history/project/export; cursor and reduced-motion behavior; cleanup on leave/disconnect.
- F10 (owner addition): automatic freehand shape recognition, including approximate right-angle triangle; normalized editable line/triangle/right-triangle/rect/ellipse; confidence gate, optional toggle, original samples retained, one-action undo restores freehand original rather than losing intent.
- R18 (owner addition): dedicated persistent highlighter pen, translucent chisel/round tip, color/size/opacity, straight-line option; uniform opacity within one stroke with separate strokes accumulating naturally; readable underlying content; layers/masks/undo/persistence/export.
- R19 (owner reference addition): brush-style menu with real stroke previews matching the supplied reference's categories: normal brush, calligraphy brush, handwriting pen, airbrush, oil brush, crayon, marker/highlighter, natural pencil and watercolor. Each category has actual different tip/pigment behavior. Full color selection applies to laser, brush and highlighter; independent remembered tool colors/settings, palettes and recent colors. Reference supplied in this chat: codex-clipboard-5882a6d7-e318-4851-ad4d-ad3d53dc6dc9.png.

- R12: local committed-operation journal, atomic durable persistence, periodic checkpoints, assets-before-references, integrity checking, pre-migration backup. Actual saving/local/sync/error states. Crash recovery, disk-full preservation, restore-as-new-history, bounded disk-backed undo. Undo, versions and experiments distinct.
- R13: PNG/JPEG/WebP/BMP, sanitized SVG, clipboard, .worldsdraw package with schema/frames/layers/assets/masks/effects/library/annotations/steps/previews/checksums; optional experiment/history inclusion. Animated-image static-frame choice, unsupported format error. PNG transparency/JPEG matte/WebP settings/clipboard/frame batch/steps/project export; sizing/background/annotations/source rights/metadata/preview/cancel/frozen export revision.
- R14: contextual customizable shortcuts B/E/G/I/T/V/M/L/Space, undo/redo, deselect, fit/100%, bracket sizes, swap, Escape; protect text fields/modals and Worlds shortcuts.
- R15: TS and Rust resource registration, dedicated view, creation/navigation/search/templates/thumbnail/embed, validated commands/MCP, drawing-aware sync/versions/restore/attachment enumeration/asset GC, no gigantic metadata blob or image-per-pointer snapshots.
- R16: benchmark hardware recorded; targets 60fps/30ms stroke, one-second local save, under-three-second medium open, 4K/30-layer/hundreds-node fixture, 512px sparse tiles, viewport LOD, bounded cache, background fill/filter/export, validated size/memory limits and graceful error/cancel.
- R17: full-size screenshots with provenance, light/dark/busy/narrow/wide/scaled, long labels and Arabic, keyboard/focus/reduced motion, real native pen/clipboard/export/relaunch, multi-client sync/disconnect and access tests, existing regression suite/build/migration checks, original-scope audit.

## Delivery order and gates

0. Engine proof: strokes/zoom/layers/Arabic/export/measurements.
1. Resource, original assets, durable document and recovery.
2. Brush/erase/color/fill/selection/undo.
3. Shapes/text/transforms/masks/effects.
4. World frames/navigation/batch export.
5. Anchors/Worlds links/tasks/embed.
6. Library/versioned reusable assets.
7. Experiments/comparison/partial adoption.
8. Steps/presentation/export.
9. Collaboration/permissions/offline/locks/author undo.
10. Real native acceptance, performance, migration, final requirement audit.

Design operation IDs, immutable assets, frame ownership and collaboration semantics before building their UI. No phase alone closes the goal.
