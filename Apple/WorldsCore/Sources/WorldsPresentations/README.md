# WorldsPresentations scope

The canonical representation is the original `slideToBlock` JSON envelope and its open attributes. Reading and serializing retain unknown fields and elements. Supported model operations edit notes, text, text style keys and geometry for supported element types. They reject ambiguous duplicate element identifiers. This is an in-memory model and does not implement saving to Worlds storage, history, undo, collaboration, or conflict handling.

`NativeSlideView` is an experimental SwiftUI rendering of the fixed 1280 by 720 slide coordinate system. It displays basic text and shapes and scales to available space. Image and video elements show labeled placeholders because attachment resolution and playback are not implemented. Background images, exact font metrics, placeholder hints, all CSS colors, layout editing, snapping, selection handles, presentation navigation and animation are not implemented. Unknown element types are represented as unsupported content. It is not an exact replacement for the current editor or presentation mode.

Synthetic tests cover round-trip preservation, editing, unknown content, invalid geometry and duplicate IDs. Five tests passed on macOS in Actions run 42387357673. The target is included in SwiftPM but is not connected to the app.
