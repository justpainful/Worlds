# Worlds Android design decisions

## Inline editor formatting
The local text editor shows the actual stored bold, italic, underline, strike,
code, highlight, color and size marks inside the editable field. The existing
Worlds preview styling is reused, with no active links while editing. Text and
UTF-16 offsets stay unchanged so the caret and selection match the saved data.
The existing neutral surfaces, warm actions, system typography, RTL behavior and
light and dark roles remain in use. No new motion or decorative elements are
added. Unsupported content retains the existing safeguards.
When the keyboard appears, the dialog reserves its inset and scrolls the focused
text field into view while keeping Save and Cancel reachable.
The find and replace dialog also reserves keyboard space, and closes the
keyboard before showing its replace-all confirmation.

## Shared page action strip
The shared page puts access, conversations, notifications, version history and
Markdown export in one compact horizontal strip above the document. These are
existing Worlds actions and icons, with accessible names and 48dp targets. The
strip scrolls horizontally if a window is too narrow, follows layout direction,
and keeps the existing permission and offline availability rules. A native tooltip
identifies each icon on hover or long press. Neutral ink
keeps the document content primary; disabled actions use the system disabled
color. The existing status text and error messages stay visible. The established
Worlds palette, Android system typography and light and dark theme remain in use.
No new motion is added.

## Duplicate shared text blocks
The existing block action menu offers Duplicate for supported shared paragraphs
and headings. It uses the existing duplicate symbol, action label and compact
menu, and places the new block directly after its source. The action uses the
current shared state, works with a previously authorized offline page and reports
failure without hiding the source. No new decorative motion is added.

## Long shared text
The shared text editor shows a bounded portion of a long paragraph at a time.
Previous and next actions and a part count use the existing labeled chevrons,
warm action color and Android typography. The full text stays in the working
draft and is saved together. Short text keeps the existing single field. A long
paragraph can jump directly to a numbered part using a compact dialog. The part
controls wrap on narrow screens and do not add decorative motion.

## Shared page Markdown export
The shared page offers the existing download icon and a labeled Markdown action
beside its history and conversation actions. A native dialog explains that the
file is a text projection of the saved shared page, that attachments and some
formatting may become text, and that an open draft is excluded. The system file
picker selects the destination. Use existing Worlds surface, on-surface and warm
accent roles, system typography and 48dp touch targets. Keep the action available
for an authorized cached page offline, and show an error if saving fails or access
is lost before the picker returns. No decorative motion is added.
The same dialog offers labeled copy and share actions using the existing copy and
share symbols. Both operate on the captured saved text and report failures in the
page. The Android sharesheet handles destination selection.

## Library action menu
The library is a list of real pages, with search and creation above it. Its
previous always-open list of creation actions consumed the page viewport on a
phone. Keep New page as the primary action and put the other resource types,
imports, templates and trash in a labeled overflow menu. Each menu row retains
its existing resource icon. The menu uses the Worlds background and ink colors,
the warm accent, Android system typography at 14sp for actions, and native
48dp minimum touch targets. On a wide display the same menu belongs to the
library pane. The action menu must support scrolling, Arabic and large type.
It shows only available actions and closes after selection. This layout uses
the existing design palette and type decisions below, including user-selected
light or dark appearance. Menu opening communicates the action hierarchy and
does not add decorative motion.

The root content color follows the current background ink so icon-only controls
remain visible in both themes. Surfaces and buttons provide their own content
colors when they use a different background.

On a failed rich-text save, the error remains in the dialog header above the
scrolling formatting controls. This keeps the failure visible on compact phones
while preserving the draft and the existing retry and cancel actions.
The keyboard closes on a failed save to make room for the error; the text field
can be focused again without discarding the draft.

When editing the sync server on the workspace page list, the keyboard hides the
large heading and secondary actions temporarily. The server field and scrollable
real page list remain available. The heading and actions return when typing ends.

On narrow phones the personal-space label sits above the creation actions,
keeping the label readable without splitting words or compressing touch targets.
The header spacing and empty-library illustration are reduced on these screens
so the empty state remains visible without covering the page list.

## Subject
Worlds is a personal and collaborative workspace for pages, documents, projects,
drawings and files. This native surface lets the owner browse, search and create
local pages with real persisted data. A shared page can be opened from an account
workspace using its page ID and sync server. Editing shared pages is limited to
text in existing paragraphs and headings; unsupported content stays untouched.

## Product vocabulary
Resource tree, page title, blocks, documents, projects, galleries, drawings,
files, streams, templates, recent edits, search, page preview, versions, trash,
parent page, metadata, instructions, annotations, collaboration, permissions.
The screen uses the resource tree, page list and recent edit time as its visual
structure. It is a working library rather than a product landing page.

## Appearance settings
Appearance is a native settings screen opened from the library header. The user chooses system, light or dark and one of Worlds' six desktop accent colors. A labeled radio row describes each choice, with the swatch as supporting information rather than the only label. The setting applies immediately to controls and system bar icons and is stored on the device. Dark accents use the desktop colors; light accents use darker related tones to keep readable contrast on the light surface. Backgrounds and long-form text retain the existing neutral Worlds palette. Account-wide preference sync is not implied.

Settings also exposes editor direction as automatic, left-to-right or right-to-left, and a switch that requests keyboard correction suggestions. These apply to local rich-text editing and shared paragraph drafts. Automatic direction follows text content. The keyboard decides whether to honor the suggestion request; code fields remain independent. Settings stay local to the Android device and do not rewrite existing content.

## Projects
Projects are containers of real local resources and references to resources
elsewhere. The project screen uses a folder icon, its actual status and a compact
overview for dates and description. Children and linked resources are separate
lists with their own actions; linking never changes a resource's parent. The
project editor uses the existing warm action color and native controls. Dialogs
retain unsaved values after a failed revision check. Missing or trashed links are
not silently removed. Creation, editing, linking and unlinking are local until
project synchronization exists.
Existing personal pages and documents can be moved into a project using their
Move action; this changes the parent, unlike linking. The same cycle and
revision checks apply as for other destinations.

## Shared page

Editors can add a paragraph using a labeled plus action below the shared page's
blocks. It opens the existing shared text editor and follows the same offline,
draft backup, access and retry states as editing a paragraph. Empty drafts do
not create blocks. A queued paragraph is visible locally while it awaits sync.
Editors can also add a heading with level 1, 2 or 3, or insert either type
after an existing shared block using its icon-led action menu. The same editor,
warm accent, permission checks and draft recovery apply. The anchor must still
be the same block when saving; otherwise the draft stays open with an error.

The workspace row opens a compact page connection screen. The owner provides the
HTTPS sync address and page ID because the current service has no public page
discovery endpoint. Once connected, readable blocks retain the page's text marks;
a pencil denotes an editable paragraph or heading. Unsupported blocks get a
quiet notice and are never rewritten. A failed edit keeps the draft visible,
while account replacement or revoked access hides account-bound content. The
screen uses the same background, ink and icon vocabulary as the local library.
When a previously authorized connection drops, the page remains readable and
supported text can be edited locally. A compact status explains that queued
edits require renewed access. Saved paragraph and heading text awaiting server
confirmation is retained as personal recovery text if access is revoked or a
write is rejected. The account screen provides a recovery library with copy and
confirmed deletion even when the workspace is no longer listed. This does not
cover legacy or unsupported edits. Unfinished text is backed up asynchronously
while editing; the last keystrokes can be lost before the disk write finishes.
The editor warns on a backup failure and confirms before discarding changes.

## Cached shared pages
The account view offers locally cached shared pages as a separate list, using
their workspace and page identifiers because local metadata has no reliable
title. Each entry opens the server-bound page and shows an offline notice until
the connection confirms access again. Editing uses the last confirmed role and
the existing durable outbox. Revocation or rejected access removes the local
shared replica and the saved permission; unsent text follows recovery rules.
Cached entries belong to the same identity account and device that opened them.

## Recovery presentation
Recovery is a collection of real edited text fragments, not a page browser.
Each fragment uses one quiet Worlds surface with a file icon, the page and
workspace identifiers, recovery reason, date, text preview and labeled copy and
delete actions. Identifiers remain visible because the service does not provide
page titles after access is removed. The same fragment presentation is reused
on the shared page and in the account library. Content respects system bars,
RTL and large text; actions wrap when the available width is small.
When the original block is present and editable, the shared page also offers
an icon-led action to open recovered text in that block's editor. A confirmation
shows the current block text and explains the effect of saving. The editor
shows the recovered text for review and the user must explicitly save it. The recovery
copy remains available until the user deletes it.

## Shared history
The shared page presents history as a labeled action with the existing history
icon. A sheet lists real server versions by date and optional label. Selecting a
version opens a read-only preview, preserving the same unsupported-block notice
as the shared page. Loading and access failures are explicit. History closes
when the page loses access or the account changes. Editors can create an
optionally named version after their pending content updates are acknowledged.
An uncertain response explains the result and requires refreshing the list
before trying again. Restoring shared history is not offered until it can safely
preserve concurrent changes and all block types.

## Shared notifications
The shared page has a labeled bell action for its sync server. A compact sheet
lists real mentions and replies, newest first, with sender, excerpt, time and a
textual unread state. It has explicit refresh and mark-all-read actions. Opening
an item marks it read after the server confirms and opens its referenced page;
the destination focuses the referenced conversation and message after comments synchronize.
The sheet disappears on account change or connection loss. No background or
system notification is claimed by this foreground feed.

## Palette
Values derive from `src/styles/tokens.css` and the requested Android light mode.
Dark canvas `#000000`, raised surface `#1C1C1E`, primary ink `#F5F5F7`,
secondary ink `#B2B2BA`, warm action `#D2A46E`, separator `#48484A`.
Light canvas `#F8F8F6`, surface `#FFFFFF`, primary ink `#1C1C1E`, secondary ink
`#59595E`, warm action `#765127`, separator `#C8C8CA`. Text colors are chosen
for contrast against their surface. The warm action color is Worlds' existing
accent, not an unrelated branding change.

## Typography and layout
Use Android's native sans family with font fallback for this initial native
surface. Worlds uses Instrument Sans and IBM Plex Sans Arabic on desktop; those
fonts are not yet bundled in Android. Use 30sp title, 17sp resource name, 14sp
supporting text and 12sp timestamps. Respect system font scaling and logical
start/end alignment. Do not add tracking to Arabic. Phone uses one column;
expanded windows keep the resource list at a readable width and expose the
selected resource in a second pane. List rows, not repeated decorative cards,
carry actual content. A quiet warm line marks the current resource.

## Signature, motion and exceptions
The hierarchy of real pages is the signature: a compact location label above a
large resource title, followed by the actual page list. The owner explicitly
requested light and dark appearance and a Worlds glass system. This first
screen uses opaque tonal surfaces until a real, tested window blur exists.
Transitions only communicate navigation and respect system animation settings.
No fabricated activity, placeholder buttons or false sync status.

## Page management
Page actions are text controls in the selected page, grouped by their effect:
rename and versions first, move to trash separately. Trash is a reversible view
of the same resource list. A version list shows actual timestamps and restores
only on explicit selection. Dialogs use Material surfaces and preserve RTL
order. Disabled actions indicate an operation in progress; errors stay visible.

## Content preview
Paragraphs and headings display their available bold, italic, underline,
strikethrough, code and link marks. Unknown blocks and formatting receive a
visible notice in the reading flow. Preview never rewrites the saved content,
and it does not claim to be the finished rich editor.

## Find and replace
The local page menu offers a labeled search action. A dialog shows the current
match, its position and count, and previous or next controls. Matching is case
insensitive by default, with an explicit case toggle. It searches text runs in
paragraphs, headings and plain code, including supported nested lists, tables, quotes,
callouts, columns and tabs, preserving the desktop editor's run boundaries.
The current match shows its block number and highlighted text. Unsupported
parts remain untouched and are called out in the dialog; supported text around inline objects can still be searched.
The selected result can also reveal its containing block in the page. The
list scrolls to that block and briefly marks it, including when a document has
a header. Supported list items, table cells and quote paragraphs scroll into
view and highlight the matched text. Blocks whose nested structure is not yet
rendered still reveal their containing block and retain the search excerpt.
Reopening search retains the query, replacement and selected result for that
page while recalculating matches against its latest visible revision.
While a local page has keyboard focus, Ctrl+F and Ctrl+H open the search and
replace dialog, matching the desktop shortcuts. The active page exposes these
commands to Android's keyboard shortcut helper. Dialogs and other focused
surfaces retain their own keyboard input. In the search field, Enter and
Shift+Enter move between results; the replacement field retains normal input.
Replace and Replace all save atomically against the captured page revision;
failed writes keep the user's query and replacement visible.

## Document foundation
The library creates a document with the existing Worlds A4 metadata and an
icon-led action. It opens in the existing block editor while paper pagination,
repeated running text and print layout remain unfinished. Paragraph and heading alignment is
available in document text editing as labeled icon choices. Left and right are
physical directions, including in Arabic. The preview uses the saved alignment;
the default follows the text direction. Other attributes and formatting survive.
Document paragraphs also expose the desktop styles Normal, Title, Subtitle and
Caption. Their previews use distinct size and emphasis, while heading levels
remain separate. Applying a style retains inline marks and unknown attributes.
Document text selection offers the desktop point-size choices and a return to
the document default. Sizes apply only to the selected text and preserve other
marks. The preview scales supported point and pixel sizes with system font size;
unsupported CSS values remain visible with the incomplete-format notice.
The document actions menu offers a labeled running-text editor. Header and
footer are shown once above and below the content in the continuous mobile
view. Saving preserves the rest of the document metadata and checks the
revision; a failed save keeps the draft open. Repetition on printed pages is
not claimed until pagination and printing are implemented.
Document body typography settings use the desktop point-size and line-spacing
ranges. Their effect is visible in the continuous document view. Changes keep
other metadata intact, use revision checks, and leave the draft open on failure.

## Text block editing
Editable paragraph and heading blocks open a focused native editing sheet with
their existing inline formatting. Bold, italic, underline and strikethrough act
on a text selection. Save writes one block with a revision check; Cancel drops
the draft. Unsupported inline objects stay read-only, with their original data
untouched. Saving errors keep the draft visible. This is one part of the full
editor, not a replacement for lists, tables, embeds or collaboration.

## Block structure
The page offers paragraph and heading creation. Each block has a compact actions
menu for inserting after it and moving it up or down. The menu also works on
unsupported blocks without changing their contents. A heading has one of the
three levels supported by the desktop editor. Block changes are revision checked.

Block, list item and table cell menus use the same existing Worlds icon family
and align every action label on a shared edge. Thin dividers separate insertion,
reordering and destructive actions. The symbols distinguish row and column
operations and retain their meaning in both reading directions. Controls keep
their text labels and disabled states, including with large system text.

## Drawing surface
A drawing opens on its own full-height canvas with a compact title bar and pen,
eraser, undo and redo controls. Ink is shown on a white frame, distinct from the
surrounding Worlds surface. Pen and mouse or touch input are supported; stylus
pressure is used when Android reports it. Save errors remain visible. The first
surface only opens drawings made by this implementation; complex desktop scenes
must not be silently flattened or overwritten. No claim of hardware latency or
palm rejection is made before device testing.

## Drawing export
The drawing toolbar offers PNG export through the system file picker. Export
uses the saved frame at its original dimensions and the same ink renderer as
the screen, including eraser strokes. The picker can be canceled without a
write. Saving progress and success or failure are visible in the drawing view.
Export is unavailable while a stroke is being saved or recovered.
The export menu also offers a Worlds project with the editable scene and its
operation history. If the portable history limit is exceeded or verification
fails, it reports the failure instead of omitting history. Complex project import
remains unavailable until its contents can be preserved safely.

## Pen settings
A compact settings dialog controls the hard pen color and pen or eraser width.
Color choices have text labels and a selected state, so the distinction does not
depend on color alone. The current width is shown as a number beside its slider.
Settings affect new strokes; saved strokes retain their original color and size.
Controls are unavailable during a stroke or save. This is not the full desktop
brush library, and unsupported brushes remain protected from silent rendering.

## Drawing navigation
Two fingers pan and pinch the frame without committing their temporary touch as
ink. A compact zoom row provides smaller, larger and fit controls for mouse,
keyboard and accessibility use, with the current scale relative to fit. Mouse
wheel zoom is anchored at the pointer. A pen
stroke keeps priority over touch navigation and its viewport remains stable while
the pen is down. The viewport is screen state and is not saved into the drawing
or applied to PNG output. The original frame remains available through Fit.


## Highlighter and marker
The drawing toolbar adds a labeled highlighter choice alongside pen and eraser.
The highlighter starts with a warm yellow ink and keeps its color and width
separate from the pen. Settings continue to expose labeled colors and widths.
Imported marker and highlighter strokes use the original continuous stroke
geometry and a single transparent layer per stroke. Their original samples and
brush properties remain in the project. Controls stay unavailable during a
stroke or save, and the system eraser remains available with either tool.


## Lists and tasks
The page can create bulleted, numbered and task lists. Each list is shown as
actual rows with its saved text and, for tasks, a labeled checkbox. A row can
open the existing focused text editor. Add item appends a blank editable row.
Supported nested lists appear at an indented level. Unsupported children are
identified without removing them; editing a supported paragraph or changing a
checkbox leaves its siblings intact.


## Nested list actions
Supported nested lists appear indented beneath their parent. Item actions offer
a sibling, a nested list, movement and removal. Removing an item asks for
confirmation because it also removes its children. Unknown children remain
identified and are preserved when other items change.


## Page Markdown export
Page actions include Markdown export and copying. An explanatory dialog states
that the text version does not contain attachments or every formatting detail.
The save action uses the Android document picker and reports the result. Export
works from a snapshot of the opened local page and does not modify it.


## Markdown import
The local page list offers Markdown import through the system document picker.
The import creates a new page using the desktop Markdown dialect and keeps the
original file bytes alongside it. The export dialog offers a way to save that
original file again. Complex blocks may remain read-only until their editor is
available. Import never replaces the selected file or an existing page.


## Code blocks
Pages can add and edit plain code blocks. Code is displayed in a monospaced face. A focused editor keeps the language separate from the code and confirms before discarding changes. Unsupported code children remain read-only so editing cannot erase their metadata.


## Quotes, callouts and prompts
Imported quote, callout and prompt blocks show their paragraphs in a quiet surface. Each supported paragraph can open the existing text editor, and new paragraphs can be appended. Unknown children remain visible as incomplete and are preserved. New blocks are available from the page actions.


## Tables
Tables display rows of bordered cells in a horizontally scrollable area. Header cells use a distinct surface. Supported paragraphs open the existing text editor. Regular rectangular tables can append rows and columns. Spans and unknown nodes are identified as incomplete and retained; the layout controls are unavailable for irregular or merged tables.


## Table cell actions
A cell menu inserts a row below or a column after the selected cell. Row and column removal requires confirmation and explains that removing the last row or column removes the table. The operation uses the revision captured when the menu action was chosen. Unsupported merged or irregular tables do not expose structural actions.


## Compact page controls
The page header keeps two labeled menus: one inserts supported block types and the other contains page actions. This recovers reading space on phones while keeping every existing action reachable in expanded windows and RTL. The page footer is reserved for the read-only state. Table cells use their text as the edit target and a separate 48 dp action target on the first paragraph; extra paragraphs remain separately editable. Column separators and the header surface (light #EAEAE8, dark #303033) are the visual structure, and 180 dp cells remain horizontally scrollable. Controls retain explicit accessibility labels.


## Account connection
A labeled Account action opens a dedicated connection screen using the existing Worlds canvas, text scale and warm action color. The screen asks for the actual HTTPS identity server and email, then the emailed six digit code. It shows connection and error states without implying that local pages sync. A connected account shows its display name and server, with explicit refresh and sign-out actions. Sign-out explains that local pages remain on the device. Tokens and codes are never rendered as account details. The layout scrolls on small screens and follows the existing RTL typography.


## Account workspaces
The connected account screen lists actual server workspaces as compact text rows with the returned role. A refresh action obtains a fresh list, and a name dialog creates a server workspace. Empty, loading and connection errors are explicit. If creation has an uncertain outcome, another create action is disabled until the server list is refreshed. Workspace rows open shared pages and the separate member list. Local personal pages remain separate.


## Shared Android interface rules
The page library, editor, account and drawing surface use the same Worlds icon vocabulary from `src/ui/Icon.tsx`. The existing desktop product uses Lucide geometry, so this project-specific icon system takes precedence over the generic anti-slop ban on using Lucide as a default. The Android vectors are generated from the installed Lucide package, with its ISC and Feather notices included in `third_party/LUCIDE_LICENSE.txt`. Standard icons are 18 or 20 dp, aligned with the label baseline and decorative to accessibility when a text label is present. Icon-only controls keep a 48 dp touch target and an explicit localized description. Back navigation mirrors in RTL.

The home screen uses the existing app mark and title as its top anchor, a single account entry, a compact search field, one personal-space heading and a primary new-page action. Creation and import actions form a quiet secondary group rather than unrelated text lines. Page rows show the resource icon, title and date in a single aligned row. The page editor uses an icon-led navigation row, a title, then insert and page action controls above the content. The account screen follows the same navigation and field icon rules and presents actual server workspaces as rows. Drawing actions use the same icon and label spacing while retaining accessible names and current pen behavior. Light and dark colors remain the Worlds tokens already defined above, with 12 to 16 dp group radii and 8 dp spacing increments. No unsupported action or simulated data appears as real content.


## Expanded windows
On tablets and Chromebooks, the account form is centered with a 640 dp maximum width and the page reading column is capped at 900 dp. The library keeps its 430 dp navigation column. When no page is selected, the remaining pane shows a real selection prompt with the existing page icon. The layout uses logical start and end alignment in Arabic.
## Shared conversations
A text-labeled comment icon opens a compact, scrollable conversation sheet for the active shared page. Existing threads retain their quoted context and resolution state, and messages show their actual author and text. A commenter can reply to an existing thread; view-only access remains read-only. The interface shows connection and write failures and closes on account change or disconnection. Text anchored thread creation and navigation remain unavailable until implemented.

Conversation controls add a labeled new-conversation action and a compact resolve or reopen action on each thread. New conversations are page-level and do not claim a text anchor. Typing @ followed by an existing participant name uses the existing Worlds mention rule. Actions are only available to accounts with comment access and display errors using the established inline treatment.
The notification opens the referenced conversation after the page has authenticated and its comments have synchronized. It focuses the referenced message, with a clear unavailable state if the conversation or message no longer exists, and offers a return to all conversations. Same-page notifications reuse the active session. The UI never assumes a cached comment is current before the sync handshake completes.

An author's deletable comment has a labeled delete action with an explicit confirmation. The first comment is protected while a thread has replies; deleting the only comment removes the thread. The same ownership and first-comment checks run again against the latest synchronized document before writing.

## Workspace members
A workspace row has a labeled members action. Its member list shows names and actual roles from the identity service. Owners and admins can choose only permitted role changes and remove eligible members, with confirmation before either write. Self and owner rows are protected. Each write uses the same signed-in account and device as the loaded list, and the list refreshes from the server afterward. If the outcome cannot be confirmed, controls stay disabled until refresh succeeds. The screen closes on account change and does not display tokens.

## Workspace invitations
Owners and admins can open a dedicated invitation list from the workspace members screen. The list shows actual role, expiry, uses and status, including whether an invitation is page-specific. Creating a workspace invite offers only roles the caller can grant. The server returns the secret link once; show it only in a temporary dialog with a deliberate copy action. Revocation requires confirmation. If creation or revocation cannot be confirmed, disable writes until the server list is refreshed. Clear the secret and close the screen on account change.

## Join a workspace
A signed-in user can paste a Worlds invite link or token, preview its workspace and role, then deliberately choose Join. The token is sent only to the account's configured identity server, never to the hostname in pasted text. Invalid, expired and revoked links have clear states. A possibly committed acceptance is not repeated automatically; the user is directed back to refresh their workspaces. The pasted secret is kept only while this screen is open and cleared when the account changes.

## Shared page discovery
The workspace opens a page picker using the identity server's access list. Show only pages with actual view, comment, edit or full access. The current service returns identifiers and levels, not page names, so label identifiers honestly and do not invent titles. A sync endpoint remains an explicit user input. The list is account-bound, supports refresh and loading, empty and failure states, and closes on account change. A manual page ID remains available for pages not yet mirrored by the identity service.

## Page access
A page access screen lists explicit and inherited entries with their source, and identifies the current account's effective access. Full-access users can set workspace, member or group levels and remove direct entries, with confirmation for each change. Inherited entries may be overridden locally but not removed at their source. Restricting or restoring inheritance requires confirmation and explains its effect. The screen reloads after every write and disables changes after an uncertain response until refreshed. The service remains authoritative and the view closes when the page or account disconnects.

## Mixed pen and touch
A stylus stroke keeps its tool and color while two fingers pan or zoom the canvas. One finger touching during a pen stroke does not draw. If Android cancels a navigation pointer, restore the viewport from before that navigation. A subtle non-exported ring follows a supported hovering pen and disappears on hover exit. Existing toolbar controls remain disabled while either drawing or navigation is active.

The drawing settings include an optional stylus-button eraser with an eraser icon, a labeled switch and a short instruction. It is off by default. The user holds the primary stylus button before touching the canvas; the stroke retains that tool until lifted. Touch and the secondary button do not activate it.

## Compact drawing controls
On a narrow window, drawing tools stay on one row: three 48 dp icon targets, the selected tool name, and a settings icon. Selection has a visible surface and an accessible selected state. The separate history and zoom row remains immediately below. On wider windows, the labeled tool controls remain visible. Both layouts use the same actions and state, adapt to RTL, and preserve room for the canvas.

Drawing settings list the implemented keyboard commands for pen, highlighter, eraser, undo, redo and fitting the canvas. The commands follow the existing desktop defaults and operate only while the drawing screen has keyboard focus. Dialogs and menus keep their own keyboard input.

## Share a page
The Markdown export dialog offers a labeled share action beside saving and copying. Its existing explanation makes clear that the shared text is a projection and does not include attachments as files. The Android chooser appears only after the user chooses Share. Oversized text shows an error and offers file export instead; it is never silently truncated.

## Templates
The personal library offers a labeled Templates action with an existing file icon. A scrollable dialog lists the actual Worlds templates with their original titles, descriptions and categories. Selecting one creates a separate editable local page. Loading, empty and failure states remain visible, and the page list continues to exclude template resources.

Personal pages have a labeled Save as template action in the page menu. It copies supported page trees into a separate custom template and confirms success inline. If the tree contains an unsupported resource, the copy is rejected as a whole with a clear error. The picker uses the same list for built-in and custom templates.

Each template row has a separate accessible actions button. Its menu offers editing and moving the template to Trash; moving requires confirmation and explains that existing pages remain. Trashed templates appear in the regular Trash and can be restored. Editing uses the existing page editor and its supported blocks.

The picker also creates a blank custom template and duplicates an existing template tree. Both actions use the existing page editor or list, and duplication creates fresh identifiers rather than linking future edits.

## Removing a block
The block action menu has a labeled trash icon action. Confirmation explains that the whole block is removed and a local version is saved first. The confirmation is tied to the page revision and block ID; a changed page rejects the action. Version history names the saved pre-removal version, and restoring it uses the existing full-page restore flow.

The same block menu offers a labeled duplicate action with the existing files icon. A copy appears directly after its source and retains its content and formatting. It gets a distinct block ID and uses the current page revision to prevent stale writes.

## Subpages
The page footer lists its actual child pages as icon-led rows and offers a labeled new-subpage action. A child opens in the existing editor; Back returns to the parent when available. The create dialog captures the parent's identity and revision so a changed or trashed parent cannot receive an unintended child. Template subpages remain in their template tree.

## Move a personal page
The page menu offers Move with the folder icon. A scrollable destination dialog offers the personal root and eligible pages, with parent paths to distinguish repeated titles. The current location is disabled. The page and destination revisions are checked when moving, and a failed or stale move leaves the tree unchanged. Template trees remain separate.

## Local page images
The page insertion menu and block menu offer image insertion with the existing image icon. Android's file picker selects a PNG, JPEG, WebP or GIF; the app copies the original bytes into private local storage before adding a Worlds image node. The page displays a bounded, orientation-correct preview with accessible name and an explicit unavailable state. Image data remains local; unsupported imports fail visibly without changing the page.

Image settings offer a caption, a 20 to 100 percent width slider, a full-width switch, and left, center and right alignment choices with icons. These map to the existing Worlds image attributes and retain the original bytes and unknown attributes. Settings save against the page revision captured when opened. Caption and alignment are shown with the image on both narrow and wide layouts.

The image block menu offers saving the original file with a download icon. The
system document picker receives the original image MIME type and a safe suggested
name. Cancellation makes no change, and success or failure appears on the page.
The action exports original bytes, including metadata, without resizing or recompression.

GIF images use the same picker, block controls and original-file export. On
Android 9 and later an animated GIF plays while its page is active. Android 8
shows a still first frame; the original animation remains intact for export.

## Inline links
The text editor offers a labeled link icon when text is selected. A small dialog accepts an HTTP, HTTPS or mailto address; applying or removing the link keeps other text marks. Supported links in the page preview are underlined and actionable. Unsupported addresses remain visible as text without becoming active links.

## Inline text colors
The existing text editor adds code and highlight actions and a labeled color action. The color dialog uses the actual Worlds text palette, with separately labeled text and background choices plus default options. Applying one attribute preserves other styles. The preview renders supported desktop colors and leaves unrecognized CSS visible as incomplete rather than changing the stored content.

## Galleries
A gallery is an ordered collection of the owner's actual media. Its media thumbnails are the visual focus, using the existing Worlds theme palette, Roboto system typography, image and file glyphs, and 16 dp content spacing. Grid and list views share the same stored order. Each item offers a full image view, move to start or end, original file export, and confirmed removal. Actions retain the gallery revision and preserve unsupported blocks. The Android file picker imports private original image bytes; unsupported media remain visible as unavailable rather than being deleted. Light and dark modes follow the existing Worlds theme. Media are local; synchronization remains future work.

Gallery audio and video use the same ordered media grid as images. Video tiles identify video content and audio tiles identify sound; opening either presents native playback controls and a clear error if the device cannot decode the file. Controls use the existing Worlds warm action color and on-surface text. Playback stops when the dialog closes or the app leaves the foreground. Original files stay in private app storage, and the export action writes the original bytes. Device codec support varies, so an imported file is not promised to play on every device.

## Presentations
Presentations show an actual 16:9 Worlds slide using the original dark stage (#16161A), warm accent (#D2A46E) and light ink (#F4F2EE). The workspace controls use the existing Worlds theme and Roboto system typography. The slide is the focus; controls for adding, editing, navigating and presenting sit around it and adapt to available width. Text and speaker notes are editable, while unsupported slide elements are retained and explicitly reported. The initial implementation is local and does not claim complete desktop editing or media rendering.

The presenter uses a black full-window canvas with a centered 16:9 slide. Compact dark controls remain legible over the slide, with previous and next actions, a slide count, and an explicit exit. System bars are temporarily hidden; keyboard navigation and the system Back action are available. Returning to the editor preserves the current slide. The slide renderer's existing limitations continue to apply.

The slide editor offers insertion of real text, shapes and local images. New items use the same 1280 by 720 coordinates and element fields as the desktop editor. The stage renders supported shapes, rotation, transparency and images in their stored order. Unsupported media and styling stay intact and are reported. A failed image import leaves the existing slide untouched.

Slide layouts use a labeled menu in the existing action group, with the six names from Worlds. Changing a layout keeps filled placeholders by role and retains other elements, matching the desktop model. The menu uses the existing theme colors and adapts to screen width.

Slide background colors use the ten desktop swatches in a labeled dialog. Text element formatting is reached from the existing element editor and uses explicit size, weight, italic, alignment and color controls. The current values are shown before editing, and saving changes only the chosen properties. The slide remains the visual reference, with the normal Worlds colors and typography surrounding it.

The background dialog also offers image selection and, when an image is present, a separate remove action. Both actions use labeled icon buttons. Selecting a picture opens Android's document picker; the slide previews it with the desktop cover behavior and keeps its background color beneath it. Removing the picture restores that color.

Videos occupy their actual slide bounds and use native playback controls over the video. They start paused, stop when the slide leaves the screen or the application stops, and show an error if their local attachment is missing or cannot play. The existing element editor supplies position, size and removal. A video is selected through Android's document picker and retains the desktop video element fields.

The editor has an explicit transform mode for direct touch, pen and mouse interaction. Tapping an element reveals a warm outline and eight small handles with larger hit targets; dragging the body moves it and dragging a handle resizes it. The preview follows the gesture and the change is saved once on release. Outside transform mode the slide keeps normal scrolling and video interaction. Numeric element positioning remains available as an accessible alternative; multi-selection is not implied by this control.

## Files
A file is a real Worlds resource with its original name, type, byte size and private attachment. The file view puts the real file and its details first, with the existing Worlds file glyph and warm action color. Android's system picker imports the file; Open uses an explicitly granted read-only content URI, and Save a copy uses the document picker. Image previews use bounded decoding. Unknown types retain the original bytes and can be opened in an installed app. File import and export are local until attachment synchronization is available.

## Pencil drawing
The drawing toolbar adds a pencil glyph beside the existing pen, marker and eraser. Its separate width control uses the same ink colors and the original Worlds natural-pencil preset. On compatible pens, the initial tilt and orientation set the pencil tip angle and roundness for that stroke; pressure affects both width and pigment. Finger input uses a neutral round tip. The resulting brush settings and raw samples are persisted in the Worlds drawing format so reopening and export use the same stroke. Physical pen behavior and latency still require hardware validation.

The file detail view can add its original image or video attachment to an existing gallery or a new gallery. The picker lists actual local galleries and keeps the source file in place. The gallery references the same private attachment, so deleting a gallery entry does not delete the file. The file view also uses the existing native media player for audio and video. The picker, player and feedback use the existing Worlds colors, typography, labeled icons and compact controls.

## External streams
A stream is a saved Worlds resource containing the actual remote link and its detected format. The stream view uses a native player surface as its focus, with the existing Worlds ink, warm action color, link icon and system typography. Link editing remains accessible without covering playback. Loading, unsupported format, connection failure and the fact that media stays remote are visible. The player handles the activity lifecycle and exposes native playback controls; a link can be edited without losing unrelated metadata.

## Editing shared comments
Authors can edit their own messages inline with the existing pencil icon and Worlds typography. The draft remains visible on failure, the save action is disabled offline, and a changed remote body rejects a stale edit. The existing queue explanation describes local persistence and synchronization.

## Drawing stroke selection
The drawing canvas stays central. A pointer tool beside the existing pen, pencil, highlighter and eraser selects an actual visible ink stroke. A warm outline marks its bounds, and dragging translates it in drawing coordinates. The operation uses the existing local drawing journal and supports undo and redo. Selection is not part of exported artwork. The canvas remains white paper with ink colors #202023, #245B93, #B33335, #2C764C and #E6C235. Controls retain Worlds warm accent and Android system typography. Eraser marks are not selectable, and this does not imply multi-object selection or synchronized drawing.

Selection mode accepts a pen or a single finger to move a stroke and a two-finger gesture to navigate the paper. Beginning a two-finger gesture cancels a finger drag; an active pen drag continues as the viewport changes. A canceled navigation restores the previous viewport. The selected stroke outline remains in drawing coordinates.

An explicit multiple-selection control in selection mode lets the user tap strokes to add or remove them. Outlines mark each selected stroke; dragging a selected stroke moves the group. Remove and Undo act on the entire group as one operation. Normal single-stroke selection remains the default, and eraser marks cannot be selected. The control is disabled during gestures and saves.

When a stroke is selected, a labeled trash action appears in the drawing controls. Removing the selected stroke is a journaled operation and Undo restores it; the action is unavailable without a selected stroke or during a gesture. The selected outline is cleared if that stroke disappears.

## Background sync failure
The shared page shows a compact error and a labeled refresh action if Android could not schedule background synchronization. The message states that local changes remain saved and asks the user to keep the page open while syncing. Retrying checks both periodic and pending-page scheduling. The notice uses the existing error color and refresh icon.

## Restore a shared version
The shared version preview offers a restore action only to editors. A confirmation explains that it changes the shared page and saves the current server state first. The existing history icon, warm action color and Android system typography remain consistent with the page. The action waits for queued content, makes a backup, and rejects a changed local base. Loading and failures stay in the history dialog. Unsupported Yjs content is rejected instead of silently discarded.

The restore confirmation also explains the verified risk to unsynchronized edits in removed blocks. A preflight check refuses unsupported reorder or move cases before creating the backup and uses the existing history error state to explain the failure.
