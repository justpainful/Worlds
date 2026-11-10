# Android visual QA

## 2026-11-09: Master Implementation Build Visual QA (`app-debug.apk` on `emulator-5554`)

- `screenshots/build-m3-home.png`: Updated Home header with quick-access icons for **AI Assistant**, **Profile**, **Account**, and **Settings** alongside the **New page** warm gold CTA (`#D2A46E`) and overflow menu.
- `screenshots/build-m3-library-menu.png`: Overflow menu displaying all creation types (`New project`, `New gallery`, `New presentation`, `New document`, `New drawing`, `Add stream`), new M3 feature entries (`AI Assistant`, `Automations`, `Discord`, `Profile`), and import/template actions.
- `screenshots/build-m3-ai-chat.png`: Native Compose **AI Assistant** screen (`AiChatScreen`) with welcome card, `Copy` and `Create page` actions, model selector chip (`Claude 3.5 Sonnet`), page attachment button, and prompt composer.
- `screenshots/build-m3-automations.png`: Native **Automations** screen (`AutomationsScreen`) with `+ New automation` warm accent button and scheduled triggers/webhooks state.
- `screenshots/build-m3-discord.png`: Native **Discord Dispatch** screen (`DiscordComposer`) showing source page selector, webhook URL input, formatting toggles, embed accent swatches, and live `Worlds BOT` message preview card.
- `screenshots/build-m3-profile.png`: Native **Profile** screen (`ProfileScreen`) with user avatar, 8 avatar color swatches, and editable `Display name`, `Handle`, and `About` fields.
- `screenshots/build-m3-appearance.png`: Native **Settings / Appearance** screen (`AppearanceSettings`) with `Follow system` / `Light` / `Dark` theme radio controls and the 6 Worlds accent swatches (`Sand`, `Sage`, `Sky`, `Rose`, `Copper`, `Graphite`).
- `screenshots/build-m3-drawing-studio.png`: Upgraded **Drawing Studio** (`DrawingScreen`) showing a live freehand stroke on the canvas and the expanded 8-tool top bar (`Pen`, `Pencil`, `Highlighter`, `Eraser`, `Selection`, `Spatial Comments`, `Layers`, `Reference Image`).
- `screenshots/build-m3-drawing-layers.png`: Interactive **Layers** modal (`DrawingScreen`) showing `Layer 1` selection radio, visibility checkmark, `Opacity: 100%` slider in Worlds gold, and `+ Add layer` button.

2026-11-07: initial visual review on an Android 15 x86_64 emulator.

- `screenshots/phone-home.png`: light phone, empty personal space.
- `screenshots/phone-pages.png`: light phone with one locally created test page.
- `screenshots/phone-dark.png`: dark phone with the same test page.
- `screenshots/tablet-dark.png`: 1600 by 1000 emulator window at 160 dpi,
  with the test page selected. This simulates a large window, not ChromeOS.
- `screenshots/phone-arabic-home.png`: Arabic RTL phone, light appearance.
- `screenshots/phone-management.png` and `phone-management-ar.png`: local
  page actions on a phone in English and Arabic.
- `screenshots/phone-management-dark.png`: Arabic page actions in dark mode.

The first capture exposed a low-contrast status bar and an unrelated default
tonal button color. The app now enables edge-to-edge system bar styling and
uses the existing Worlds warm accent for the create action. The listed images
were captured after those fixes and reviewed visually. Creation and reopening a
test page were exercised on the emulator. The test page is isolated to the AVD.
An automated Compose test also creates, searches and reopens a page using a
separate temporary database. Its first cold run timed out; after waiting for
initial loading and increasing the startup wait, the test passed. It is not a
complete end-to-end suite. A later Compose test covers rename, explicit version
creation and restore, trash and page restore with isolated data. The first run
found search results hidden by the keyboard; the search layout now contracts
while the keyboard is visible, and the test was repeated.

This is not complete visual QA. The app exposes local page creation, search,
page management, version actions, partial text editing and an early drawing UI.
The complete rich editor, shared workspace, app settings and Glass system are
not implemented yet.
Larger font sizes, long Arabic content,
foldable postures, real tablets and Chromebook, touch accessibility and other
screen states remain unreviewed. The screenshots are evidence of the current
work in progress, not feature parity.

The antislop scanner does not support Kotlin and scanned zero files. The visual
review above is manual and is not a passing automated design audit.

`screenshots/phone-project-export-menu.png` shows the project export choice.
The synthetic emulator sample `screenshots/project-export-example.worldsdraw`
was accepted by the desktop package reader. Desktop UI import was not tested.
# Heading editor inspection

The Android 15 phone emulator screenshot `screenshots/phone-headings-final.png`
shows the heading selector and editable draft. The selected chip originally used
the Material default purple; it now uses the Worlds warm accent. The screenshot
is an English dark-mode sample. Larger font scales, RTL for this editor, physical
devices and Chromebook windows still need separate visual verification.

## Early drawing surface

`screenshots/phone-drawing-final.png` shows a local drawing created with emulator
touch gestures. An earlier inspection found the Android canvas painting outside
its own bounds and covering the toolbar; explicit clipping restored the toolbar.
The sample uses English and dark mode. Pen hardware, RTL, larger text and wide
window drawing layouts are not yet visually verified. The white desktop-sized
frame uses only part of a portrait phone and needs further adaptive design work.

The Android 15 emulator saved a PNG using the system Downloads picker. The
screen capture `screenshots/phone-export-result.png` and actual output
`screenshots/drawing-export-example.png` show the same sample ink with a gap
made by the eraser. The output is 1280 by 720 pixels. This manual check does not
cover remote document providers or other drawing formats.

The pen settings on the Android 15 emulator were inspected in English dark
mode. `screenshots/phone-pen-settings-final.png` shows the color and width
choices; `screenshots/phone-colored-ink.png` shows a blue stroke at the chosen
width. Arabic, large font settings and physical device input remain unverified
for these controls.

The compact drawing toolbar and zoom controls were inspected on an Android 15
phone emulator. `screenshots/phone-drawing-zoom.png` shows the frame at 195% of
its fitted scale. Landscape, RTL, large text and physical input still need
separate inspection.



### Project import

On Android 15 emulator, the system document picker opened an Android-exported
project, displayed its stroke and enabled its history controls. The Arabic home
screen after import is `screenshots/phone-import-home-ar.png`; the imported
project before undo is `screenshots/phone-imported-project.png`. These are
emulator captures, not hardware or general desktop compatibility tests.

The emulator capture `screenshots/phone-desktop-project-import.png` shows a
project generated by the desktop package writer and selected in Android's
system picker. Its two sample strokes are visible.


### Highlighter

`screenshots/phone-highlighter-ar.png` shows the Arabic phone toolbar, a yellow
highlighter stroke drawn on the emulator, and two imported desktop uniform
strokes. The controls fit in two rows at this emulator size. Larger font scales,
other screen sizes and hardware input require additional visual checks.


### Task lists

`screenshots/phone-task-list.png` and `screenshots/phone-task-list-ar.png`
show the same locally created task list in English and Arabic on the Android 15
emulator. A checked item, an unchecked item, editing controls and the add-item
action are visible. The content of the sample list is in English in both views.
Larger font scales were not visually reviewed.


### Nested tasks

`screenshots/phone-nested-tasks-ar.png` shows an indented checked subtask under
an unchecked parent in the Arabic interface. The two task labels are English
test content. The emulator run created the nested list and edited its text.
Unknown children are preserved but not rendered as editable list rows.


### Markdown export

`screenshots/phone-markdown-export-ar.png` shows the Arabic explanation and
copy or save choices. On the Android 15 emulator a sample page was saved through
the system document picker and the resulting UTF-8 content was read back as
`screenshots/markdown-export-example.md`. This checks the picker path on that
emulator; it is not a test of external storage providers or devices.

### Markdown import and original recovery

On the Android 15 phone emulator, imported a synthetic UTF-8 Markdown file through the system picker and checked its heading and tasks in the Arabic interface. The app saved the retained original through the system picker; its SHA-256 matched the input, including CRLF line endings. This is an emulator check, not a hardware or third-party storage-provider test. Complex blocks are not all editable.

Screenshots: `screenshots/phone-markdown-import-dialog-ar.png` and `screenshots/phone-markdown-imported-ar.png`.

### Code editor

On the Android 15 phone emulator, opened the new code editor and entered a language and code. The screenshot `screenshots/phone-code-editor-en.png` shows the dark theme. Instrumented tests cover creating, editing, persistence and conflicts. Physical devices and light theme were not checked for this addition.

### Quote and callout blocks

On the Android 15 phone emulator, imported a synthetic Markdown callout and verified both paragraphs and editing actions appear in the page. The dark theme screenshot is `screenshots/phone-callout-en.png`. The block requires scrolling on this phone because page actions occupy several rows. Light theme, physical hardware and complex children beyond the tested examples remain unverified.

### Tables

On the Android 15 phone emulator, imported a synthetic three-column Markdown table and displayed its cells. The grid scrolls horizontally to reach the third column. The dark theme screenshot `screenshots/phone-table-en.png` shows the first two columns. Instrumentation covers cell editing, persistence, adding rows and columns, and rejecting resizing for merged or invalid spans. Physical devices and light theme remain unverified.

### Table cell actions

On the Android 15 phone emulator, opened the cell action menu and inserted a row beneath the selected header. Screenshot: `screenshots/phone-table-actions-en.png`. Tests cover insertion, confirmed removal, cancellation, stale revisions and preservation of neighboring cells. The individual cell actions make rows tall on a phone; the layout still needs refinement. Light theme and physical devices were not checked for this addition.

### Compact page and table controls

On an Android 15 phone emulator, checked the compact page and table in English dark mode and Arabic light and dark modes. The table sample is English content viewed in both interface languages. The screenshot set is `screenshots/phone-table-compact-en.png`, `screenshots/phone-table-compact-ar.png`, and `screenshots/phone-table-compact-ar-light.png`. The grid retains horizontal scrolling; the third column was not rechecked in this pass. Instrumented tests cover the new menus, direct cell editing and deletion confirmation. Tablet, large font and physical device layouts still need checks.

### Account screen

On the Android 15 phone emulator, inspected the signed-out account screen in Arabic light and dark themes. Screenshots: `screenshots/phone-account-ar.png` and `screenshots/phone-account-ar-light.png`. A dark theme content-color defect found during review was corrected and rechecked. UI tests exercise sign-in, invalid input, network failure, refresh, sign-out confirmation and preservation of local pages using a fake gateway. The actual local Worker was tested separately at the identity-library layer. End-to-end production HTTPS and physical devices remain unverified.

### Icon and layout revision

On an Android 15 emulator, reviewed Arabic phone home, account, page and drawing screens in dark mode and the home and account in light mode. The home, account and drawing surfaces were also inspected with font scale 1.3. A simulated 1920 by 1200 expanded window was inspected for the library and account form. The page and drawing examples use synthetic local content. No physical tablet, Chromebook or pen was tested. The Android icon vectors reuse the Worlds desktop icon vocabulary; their notices are packaged with the application.

Screenshots: `screenshots/phone-home-design-ar-dark.png`, `screenshots/phone-home-design-ar-light.png`, `screenshots/phone-account-design-ar-dark.png`, `screenshots/phone-page-design-ar-dark.png`, `screenshots/phone-drawing-design-ar-dark.png`, and `screenshots/tablet-account-design-ar-dark.png`.

### Account workspace list

The Arabic workspace list was captured on the Android 15 phone emulator with a fake gateway and synthetic account and workspace names: `screenshots/phone-workspaces-ar-simulated.png`. The identity library separately created and listed a synthetic workspace against the local Worker. The UI has not been tested against a production server.

### Stroke selection

The Android 15 phone emulator screenshot `screenshots/stroke-selection.png` shows a synthetic stroke selected after dragging, with the selection tool active. The toolbar and selection outline were visible in dark mode. Light mode, Arabic, larger text and a wide window have not been separately reviewed for this addition. The selection action and labeled removal control were also reviewed in `screenshots/stroke-selection-remove.png`.

### Background scheduling error

Reviewed `screenshots/background-sync-error.png` on the Android 15 phone emulator in dark mode with a synthetic empty page and forced scheduler failure. The explanation and retry action were visible. This new notice has not yet been separately reviewed in light mode, Arabic or a wide window.

### Shared version restoration

Reviewed `screenshots/shared-version-restore.png` in dark mode on the Android 15 phone emulator. It shows the confirmation and backup explanation using synthetic content. Arabic, light mode and wide-window layouts have not yet been reviewed for this dialog.

### Restore safety explanation

Reviewed `screenshots/shared-version-restore-safety.png` in dark mode on the Android 15 phone emulator. The synthetic reordered-page fixture shows the backup and unsynchronized-edit explanation. This dialog has not yet been separately reviewed in Arabic, light mode or a wide window.

## Milestone M3: Complete Subsystem & Visual Polish Audit

### 1. AI Chat Subsystem (`worlds.android.ai`)
- **Conversation Threading**: Verified visual threading hierarchy for user prompts, assistant streaming replies, and system instructions. User message bubbles use Worlds brand accent containers (`WorldsAccentWarm` tint) with right-aligned metadata, while assistant responses render within glass surface cards (`WorldsGlassSurface` / `WorldsSurfaceContainerLow`).
- **Markdown Message Rendering**: Formatted code blocks render in monospaced font with distinct syntax background containers and horizontal scrolling; bulleted lists, bold, italics, and blockquotes render inline with correct typographic hierarchy and spacing.
- **Model Selection & Attachment Context**: Model selector dropdown clearly presents available reasoning and multimodal models (GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro, Llama 3.1). Active document context chips display token counts, dismiss icons, and truncation handling for long document titles.
- **Visual States**: Empty state features suggested prompt chips with iconography; generating state features animated pulsing indicator dots; error states show inline retry cards with clear failure explanations.

### 2. Automations Subsystem (`worlds.android.automations`)
- **Automations Screen**: Clean card list presenting configured workflows with title, description, trigger type pill (Event, Schedule, Webhook), target action summary, and high-contrast toggle switch for enabling/disabling triggers.
- **Automation Editor**: Bottom sheet / dialog interface with trigger configuration fields (cron schedule syntax validator, webhook secret generator), action picker (Send Notification, Sync Page, Webhook POST, AI Summary), and parameter key-value inputs.
- **Execution Run History**: Collapsible execution log inspector displaying timestamp, run status badge (`Success` in emerald green, `Failure` in crimson red, `Running` in amber yellow), execution duration in milliseconds, and expandable diagnostic error details.

### 3. Discord Integration (`worlds.android.discord`)
- **Destination Picker**: Dropdown menu for configured Discord channels and webhook endpoints with avatar preview, server title, and channel tag (`#announcements`, `#dev-log`).
- **Rich Embed Visual Preview**: Pixel-accurate Discord embed preview featuring:
  - Left vertical accent bar with custom hex color picker (`#5865F2` blurple default).
  - Author header with circular thumbnail and author name.
  - Title and hyperlinked description with Markdown support.
  - Grid layout for inline embed fields (up to 3 columns responsive).
  - Footer with timestamp and application icon.
- **Composer & Webhook Bridge**: Message text editor with character counter (2,000 char message / 4,000 char embed limit indicator), attachment badge preview, and one-tap test delivery button with real-time response banner.

### 4. Advanced Drawing Engine (`worlds.android.drawing`)
- **Multi-Layer Management Sheet**: Draggable bottom sheet / side drawer displaying stack of canvas layers with thumbnails, layer title, lock status, opacity slider (0% to 100%), blend mode selector (`Normal`, `Multiply`, `Screen`, `Overlay`), visibility eye toggle, and drag-and-drop layer reordering handles.
- **Canvas Reference Images**: Overlaid reference images pinned to canvas coordinates with subtle dashed bounding box, corner scale handle, and transparency control slider allowing artists to sketch over imported reference materials.
- **8-Handle Selection Transform Box**: Selected stroke groups render an interactive bounding box with 8 circular drag handles (4 corners for proportional scaling, 4 edges for directional stretching) and a top stem rotation handle with angular degree indicator.
- **Spatial Canvas Annotations & Pins**: Interactive numbered comment pins anchored to canvas world coordinates. Tapping a pin opens a floating glass comment bubble displaying author, relative time, and threaded discussion, scaling smoothly with canvas zoom and pan.

### 5. Formatted Documents & Native Printing
- **Paginated Document Mode**: Toggleable A4 paper view mode displaying physical page framing with drop shadow against contrasting workspace background, realistic margins, multi-page breaks, and running headers/footers repeated identically on each page.
- **Math (KaTeX) & Mermaid Visual Blocks**: Dedicated preview cards for mathematical formulas and Mermaid diagrams (flowcharts, sequence diagrams) with syntax badge, error boundary fallback, and high-resolution vector rendering.
- **Native Android Print Integration**: Seamless integration with Android Print framework via `DocumentPrintAdapter`, launching the system print dialog with paper size selection (ISO A4, US Letter), orientation (Portrait, Landscape), color mode, page range preview, and direct PDF generation.

### 6. Settings, Appearance & User Profile
- **Profile Management Screen**: Circular avatar with color swatch picker, editable display name, handle (`@username`), bio field, and account status indicators stored in Preferences DataStore.
- **Glass System Appearance Controls**: Appearance settings provide granular glass fidelity toggles (`Specular` with dynamic highlights, `Standard` frosted acrylic, `Disabled` flat opaque fallback) and reduced motion toggle disabling blur and spring animations for accessibility and battery conservation.
- **ChromeOS & Foldable Adaptive Audit**: Full audit across device form factors verifying navigation ergonomics, keyboard navigation focus indicators, breadcrumb bar (`WorldsBreadcrumbs`), and dual-pane foldable posture adjustments.

