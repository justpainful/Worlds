# WorldsDrawing scope

This module reads and re-encodes a schema 1 scene as open JSON, retaining fields it does not understand. It checks basic container structure and schema version only. It does not implement the full validation rules in `src/drawing/model.ts`; do not write the result into a user's original data store based on these checks alone. The drawing document envelope and its operation journal are retained as opaque JSON, but the document parser does not itself validate or replay operations. The separate experimental DrawingJournal can replay the subset described below. The module does not handle migrations, undo, shared synchronization, assets or attachment ownership.

`DrawingRenderer` is an experimental CoreGraphics preview. It draws basic top-level layers, rectangular, rounded rectangular and elliptical shapes, and approximate hard, pencil, ink and marker strokes. It reports every approximate or unsupported visible element. The preview is always marked non-exact and cannot be treated as an authoritative export. It does not implement native text, images, references, raster effects, brushes beyond the listed approximations, alpha locking, erasure, accurate pressure rasterization, gradients, nested layer composition, masking, dashes, paths, selection, transforms, laser, frame presentation, collaboration, or export parity. Frame and canvas coordinate transforms require visual verification against the original renderer.

The initial scene tests passed on macOS in Actions run 42387357673. Later tool and journal tests are not yet verified. The module is included in SwiftPM but is not connected to the app.


## Experimental input helpers

`DrawingTools.swift` builds schema-shaped stroke edit operations for the source brush kinds, including textured brush settings, as well as eraser strokes. It retains pressure, tilt, time, color and alpha-lock metadata and translates samples into node-local coordinates. Inputs outside its supported ranges are refused. It does not render pressure, reproduce original textured brush rasterization, validate layer or frame ownership, apply edits, validate the complete scene or save to storage. The generated operation must not be applied to user data until it passes the original store's validation and integration tests. Unknown brush kinds are rejected explicitly. Texture and tip assets are retained as metadata; textured rasterization is not implemented.

`LaserOverlay` is in-memory session data only, with color, lifetime and linear fade. It is not connected to rendering or collaboration. `ShapeRecognition` implements conservative line, rectangle, ellipse and triangle/right-triangle recognition based on the source thresholds; correction operations are not implemented. The contour algorithm has not been tested against all source inputs and does not provide complete recognition parity.

`DrawingToolsTests` includes a stroke JSON fixture generated from the original `newNode`, `strokeBounds`, and `putNode` code, plus source-generated recognition and pressure fixtures, and checks for metadata and laser. These XCTest cases and fixture comparisons have not run on Apple. SwiftPM includes the three fixtures as test resources. No editing UI or export was enabled.

The CoreGraphics preview approximates pressure-dependent size and opacity for supported strokes. It is not a pixel match, ignores taper, dab spacing and source texture, and remains marked non-exact. Eraser compositing and brush asset rendering remain unsupported.



## Experimental journal and selection

`DrawingJournal` applies put, remove, patch, ordering and default-frame edits to an in-memory schema 1 document. It checks revisions, operation IDs and authors for toggles, supports frontend-style per-author undo/redo target selection, and replays toggles from the seed rather than overwriting another author with a flattened snapshot. It preserves unknown envelope fields and exposes the existing JSON document round trip. It performs structural checks only, not the full `validateScene`, native SQLite permissions, asset ownership, pixel guards, version restore receipts, journal size, or synchronization authority. Guarded and unknown new operations are rejected rather than simplified. This must not be used to mutate or export user projects until the original validation and persistence path is integrated.

`DrawingSelection` resolves explicit IDs in scene order and prepares basic transform patch values. It is not a geometric selector or handle UI, and it does not implement mask, anchored reference, text, group, layer hierarchy, snapshot and special transform semantics. `DrawingDocument.json()` writes the document JSON envelope, not the original portable project package. Original packages can include assets, versions and metadata; package import/export and visual export are still missing. Do not name or advertise this JSON as a full project export.

`original-journal-fixture.json` was generated with the original TypeScript `newDrawing`, `edit`, `appendOperation`, `historyToggle`, and `putNode`. The XCTest compares add, move, undo, redo and JSON round trips against that fixture and checks selected invalid requests. The fixture is included in SwiftPM; these tests have not run on an Apple SDK.
