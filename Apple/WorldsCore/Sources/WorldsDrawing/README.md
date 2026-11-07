# WorldsDrawing scope

This module reads and re-encodes a schema 1 scene as open JSON, retaining fields it does not understand. It checks basic container structure and schema version only. It does not implement the full validation rules in `src/drawing/model.ts`; do not write the result into a user's original data store based on these checks alone. The drawing document envelope and its operation journal are retained as opaque JSON, but operations are not validated or replayed. The module does not handle migrations, undo, shared synchronization, assets or attachment ownership.

`DrawingRenderer` is an experimental CoreGraphics preview. It draws basic top-level layers, rectangular, rounded rectangular and elliptical shapes, and approximate hard, pencil, ink and marker strokes. It reports every approximate or unsupported visible element. The preview is always marked non-exact and cannot be treated as an authoritative export. It does not implement native text, images, references, raster effects, brushes beyond the listed approximations, alpha locking, erasure, pressure, gradients, nested layer composition, masking, dashes, paths, selection, transforms, laser, frame presentation, collaboration, or export parity. Frame and canvas coordinate transforms require visual verification against the original renderer.

The tests use synthetic scene data and have not been run on Apple platforms. The module is not added to Package.swift or wired to a UI, by request.

