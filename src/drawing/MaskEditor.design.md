# Worlds alpha-mask editor

Subject: paint and inspect a reversible grayscale mask on a drawing element or one image adjustment.

Vernacular: white reveals, black hides, gray gives partial coverage. The working surface is the mask raster; a second view renders the real artwork with the draft mask.

Palette and type: inherit Worlds surface #1C1C1E, neutral surround #242426, ink #F5F5F7, secondary #AEAEB2 and owner accent #D2A46E. Black and white are actual alpha values. Use Instrument Sans, bundled IBM Plex Sans Arabic15.5px/1.7 with zero tracking, and the existing numeric font.

Signature: one grayscale surface beside an actual composited preview. Brush, contiguous/global fill, two-ended linear gradient, invert, full reveal/hide and isolated-mask view expose the underlying alpha operation directly.

Geometry and states:860px existing Modal,340px work surface,32px control targets. A lease starts on opening; pending, lost lease, stale source, read-only, processing and error states disable Apply. Every heavy raster edit and PNG encoding uses a disposable worker. Cancel imports no file and adds no history. Apply owns one PNG and one new mask so shared originals stay untouched.

Linking fixes mask coordinates to the element; unlinking bakes the current mask at its world position. Rotated unlinking is an explicit raster resampling operation. Working masks are limited to16 million pixels and image effects to the4K-compatible8-million-pixel working bound. Existing group buffers retain their separate256MiB bound.

Image blur uses a box kernel with transparent pixels outside the crop. A uniform opaque source therefore loses alpha at its crop boundary, while retaining its unassociated color. The independent raster oracle explicitly counts4/9 corner and6/9 edge coverage for radius1; it does not relax the premultiplied RGBA8 tolerance2.

Scanner notes: references to the JavaScript Blob type and variables are encoded PNG data, not decorative glow or background shapes. MaskDialog and RasterizeImageDialog each produce four Blob-token false positives; no ambient visual blob is drawn.

Layer merge uses a dedicated sheet: all visible, clipped, nonoverlapping integer-bounded frames are baked into one PNG each at one document pixel per source pixel, including their paper colors. Original elements on the existing output root are hidden, and other source roots are hidden in place. Nesting and original data remain intact for Undo. Reusing an existing root prevents a later foreign node from becoming orphaned when the merge is undone. World items, unbounded frames, overlaps and step-specific hidden-node views are refused explicitly. Originals are never replaced by a plain group. Live text and links in the merged result become a frozen raster copy; originals remain editable when restored.

LayerMergeDialog has one Blob-token scanner false positive for encoded frame PNG data. This is not an ambient visual decoration.
