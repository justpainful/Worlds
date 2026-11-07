# Worlds native design decisions

This brief governs native UI work and remains subject to visual validation on each supported platform.

## Product and vocabulary

Worlds is a local-first workspace for pages, documents, drawings, projects, presentations, media and shared work. The primary task is to find or create a resource and continue working in its native editor. Product vocabulary comes from the existing sidebar, page tree, block editor, paper document, slides, drawing canvas, layers, frames, brush, timeline, history, version, search, templates, project, gallery, attachment, stream, collaboration presence, permissions and assistant.

The recognizable interaction is a resource tree that leads directly into the relevant canvas or editor while preserving the current context. The editor content, not decorative panels, occupies the majority of the window. Compact layouts navigate between contexts; wider layouts retain the tree and show an inspector only when useful.

## Color and type

The existing identity in `src/styles/system.css`, `src/styles/tokens.css` and `src/styles/resources.css` supplies the palette. Exact contrast and native material behavior must be checked against actual light and dark screenshots.

| Role | Existing color | Reason |
| --- | --- | --- |
| Dark canvas | `#0C0C0E` | Existing Worlds canvas |
| Dark sidebar | `#121215` | Existing navigation surface |
| Raised surface | `#242428` | Existing toolbar elevation |
| Light paper | `#FDFDFC` | Existing document paper |
| Light paper ink | `#1C1C1F` | Existing document text |
| Accent | `#D2A46E` | Existing Worlds accent, used only for meaningful emphasis |

Use the native system font with Dynamic Type for interface and reading text; the existing editor offers serif and monospace alternatives. Use the system monospaced design for technical values, and the system Arabic fallback for Arabic shaping. Follow the original 34/26/20/16.5/14/13/12 hierarchy as a relative guide rather than fixed pixel sizes. Preserve appropriate Arabic line spacing and do not add letter spacing to Arabic. Light mode uses semantic platform backgrounds and text with the existing paper colors where appropriate.

## Materials and motion

Use native Liquid Glass for contextual toolbars and floating controls on supported systems, with native materials on older systems. Keep the page and canvas readable and opaque where needed. The user explicitly requests light and dark appearance, native glass and motion; these decisions take precedence over generic design defaults. Motion indicates navigation, direct manipulation and state changes, uses interruptible native transitions, and respects Reduce Motion. Test keyboard focus, content size, RTL, small windows, multiple windows and touch targets before claiming visual completion.

## Review status

No native UI or screenshot has been reviewed. The palette, typography, contrast and adaptation decisions must be verified with real application content on all requested device sizes before completion.
