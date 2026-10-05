# Worlds native content system

Worlds grows from "everything is a Page" to a workspace of **resources**. A Page is one resource kind among several.

## Model

Every resource is a row in the existing `pages` table, distinguished by `kind`. The table already carries:

- the tree (`parent_id`, `sort_key`)
- the sidebar, search, recent and favorites
- pins, archive and trash
- history, versions and undo
- references
- Claude/MCP access

So every kind gets all of that, with persistence, from the first day. Existing data needs no migration: rows stay `page` or `template`.

| Kind | Content lives in | Notes |
| --- | --- | --- |
| `page` | blocks (Tiptap nodes) | unchanged |
| `document` | blocks + `metadata.doc` | paper size, orientation, margins, header, footer, default style |
| `presentation` | blocks of type `slide` | each slide: layout, background, notes, positioned elements |
| `gallery` | blocks of type `galleryItem` | attachment + caption; manual order = block order; `metadata.gallery.view` grid/list |
| `file` | `metadata.file` | the attachment id; preview by type; no blocks |
| `stream` | `metadata.stream` | external URL + format (HLS, DASH, progressive); never treated as a local file |
| `project` | `metadata.project` | status, dates, description; children by tree; `metadata.project.links` for linked resources that live elsewhere |
| `template` | blocks | unchanged (not a resource the user browses) |

Moving a resource into a project sets `parent_id`. Linking keeps it where it is and adds its id to the project's links. Its identity never changes.

## Integration

- **Search:** titles plus the text of slides, captions, and file and stream names are indexed.
- **Sidebar, palette, recent, favorites, trash:** every kind, each with its own icon.
- **New:** offers each kind. Uploading creates a `file` resource, never an empty page.
- **Claude/MCP:** tools report and accept `kind`, and there are per-kind tools (presentations, galleries, files, streams, projects) alongside the block tools.

## Phases

1. Model, kinds, creation, navigation, per-kind views with real persistence.
2. Document editor (paper layout, styles that inherit, page setup, print/export).
3. Presentation editor (navigator, canvas, elements, snapping, notes, present mode).
4. Gallery, file and stream polish (thumbnails, ordering, info, player).
5. Project overview (status, dates, sections by kind, links, activity).
6. Claude/MCP per-kind tools.
