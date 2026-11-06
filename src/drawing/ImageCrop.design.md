# Image crop sheet decisions

Subject: crop a Worlds image original without replacing its bytes, then compare crop or image effects before committing one edit.

Vernacular: original image pixels, crop boundary, source dimensions, linked alpha mask, fenced reservation and one journal edit. The source image itself is the control surface.

Palette: reuse Worlds surface #1C1C1E, neutral surround #242426, ink #F5F5F7 and secondary #AEAEB2. Crop edges use white and #202023 for contrast over actual image content; the existing #D2A46E accent belongs only to Apply. These values inherit light-mode tokens.

Typography: Instrument Sans for Latin, bundled IBM Plex Sans Arabic at15.5px/1.7 with zero tracking, and the existing measurement font. Reuse Modal, Button and drawing-field controls.

Signature: draggable source-pixel crop edges over the immutable original, followed by two genuine renderer previews of the committed appearance. No decorative animation or generated artwork.

Geometry:860px modal capped by the existing viewport rules; source preview340px high; paired previews collapse to one column below600px. All crop grips have32px stroke hit regions and keyboard access. Cancel, loss of rights, stale source or a lost reservation changes no artwork.
