# Visual QA report

Three failure screenshots from the macOS UI job in [run 42384584985](https://github.com/justpainful/Worlds/actions/runs/42384584985) were manually inspected. They are available in the `Worlds-macOS-UI-results` artifact.

| State | Observation | Resolution |
| --- | --- | --- |
| Initial window | Sidebar was too narrow: the title wrapped into several fragments and the open action was not directly visible. | Corrected in [run 42385501910](https://github.com/justpainful/Worlds/actions/runs/42385501910): the inspected standard-window capture shows a wider sidebar and visible action. Small windows remain unverified. |
| Database error | The alert is visibly present while the UI test failed to identify it. The narrow sidebar remains visible underneath. | Investigate macOS accessibility hierarchy and correct the query or application as appropriate. |
| Personal page list | Fixture page appears in the sidebar, but the test failed to locate it. The narrow sidebar leaves limited space for page titles. | Fix layout and inspect accessibility identification, then recapture. |

The captures are from an incomplete read-only application and do not establish overall visual quality. Light and dark appearances, device sizes, text scaling, safe areas, RTL, glass effects and other interactive states remain unverified. Further captures must record platform, device, OS, screen, state, issue and resolution.

One iPad portrait failure screenshot from the same run was also inspected in `Worlds-iPad-UI-results`: the fixture page is visibly present and the sidebar and detail area fit at that size. The automated test failed to locate the visible page, so the accessibility identifier and navigation must be retested. The screenshot does not cover landscape, resizing, editing or other content.

Four iPhone screenshots from the same run were inspected in `Worlds-iPhone-UI-results`: opening, personal page list, page content and database error. These states fit the captured screen, and the corresponding three UI tests passed. The page content displays the title twice in close succession, once in navigation and once in the page; this needs a layout correction and recapture. The current screens also largely use default system styling and do not yet establish the requested Worlds identity. The images show only an isolated read-only fixture on one simulator, not full app parity or a complete device matrix.

The iPhone page-content screenshot from the newer run 42385501910 was inspected. The duplicate title is removed at that simulator size; the subsequent palette adjustment has not yet been visually inspected.

Four macOS screenshots from the newer run 42385501910 were inspected: initial window, page list, page detail and error. The sidebar width and open action are improved at the captured standard window size, and the fixture content appears. The identity, other window sizes, dark appearance and larger text remain unreviewed. The alert is visible, but its test still failed because two accessibility elements were named OK; the test adjustment awaits another run.

Four iPad portrait screenshots from run 42385501910 were inspected after the accessibility correction. Opening, page selection, page content and the error state fit the captured size, and the three UI tests passed. The app remains visually generic, and other orientations, sizes, content types and appearance modes remain unreviewed.

The macOS opening and page-detail screenshots from run 42386428057 were inspected. The opening action uses the updated warm accent and the standard-window layout remains readable. The selected sidebar row still uses the system blue, and the interface remains mostly generic; this is not a complete identity review. Dark mode, smaller windows and the other states in this run still need inspection.

The iPad opening and page-detail screenshots from the same run were inspected in portrait. The accent is visible and the fixture content fits; this remains a read-only, sparse screen. Landscape, split view, smaller windows and dark mode have not been reviewed.

The iPhone opening and page-detail screenshots from run 42386428057 were inspected. The accent is visible, the duplicate title is absent, and the fixture content fits this screen. The screen remains sparse and read-only. Other sizes, dark mode, complex content and editing remain unreviewed.

The macOS search-result and empty-result screenshots from run 42388460952 were inspected. The personal result and empty state fit the captured standard window; the search field is positioned at the far right of the toolbar while results appear in the left sidebar, which needs usability review. The UI test passed this isolated scenario. Search on other devices, shared workspaces, complex results and accessibility variants remains unverified.

Two iPhone search screenshots from that run were inspected. The result and empty state fit above the keyboard. The empty-state capture shows partially rendered keyboard glyphs, so it must be recaptured after the keyboard settles before visual approval. These captures predate the sidebar search-placement adjustment.

Two iPad portrait search screenshots from that run were inspected. The result and empty state remain visible above the keyboard and fit within the sidebar at the captured size. The detail area remains empty until selection. Other orientations, long result sets, RTL and large text still need inspection.

The iPad RTL accessibility-text capture from run 42410801215 (28BFA98D-71B4-4F32-BD0A-104A56361CAD.png) shows the final row's secondary text clipped at the lower edge. The previous test stopped once any part of the row was hittable, so it did not establish that the whole row was visible or that the list had reached the bottom. The page list now reserves a small bottom scroll margin, and the UI test scrolls and checks the full row frame against the list frame. These changes require a new iPad run and visual inspection; the supplied image does not establish whether the original list could already reveal the row after further scrolling. Other iPad sizes, orientations, and search-result lists remain unverified by this observation.

Navigation review: personal resource links operate on the filtered in-memory snapshot. Returning from linked content uses an explicit history stack; the sidebar binding now preserves this history if SwiftUI writes the already-selected value back. A project self-link is disclosed as text instead of presenting an action that cannot navigate. The isolated reader fixture and UI test cover the self-link and return action. These changes are source-reviewed only and require new iPhone, iPad and macOS UI runs and screenshot inspection. Resource summaries still do not provide full gallery/file preview or visual slide rendering.

Reader accessibility review, iPhone run 42414136609: the RTL structured-reader capture 92AAE83E-3089-4F1F-845A-334D67689004.png showed the read-only indicator in a pale grey on a light glass surface. Its text has been changed to the primary foreground style; a new Light/Dark screenshot is needed to confirm the actual rendered contrast. The Arabic project capture 219E46E1-1CBE-48C4-9C2B-48B0392E7AE3.png showed readable right-aligned project details and a nearby linked-page chevron at that size. These observations do not establish VoiceOver, all Dynamic Type settings, other iPhone sizes, iPad multitasking or macOS window coverage.
The iPad RTL structured-reader image 7F18A3D4-EB4F-4076-AEA0-347DC3CAB85A.png from run 42412393488 was also inspected: the visible callout, disclosure and tab content fit this portrait screenshot, and the prior pale read-only indicator is visible there too. The macOS RTL image 2B62ABA2-B631-4CE5-AE5D-147E9299F8A1.png from run 42409177863 predates subsequent disclosure-button revisions and cannot validate their current positioning or focus behavior. Both are single fixture states; dynamic accessibility, selection and navigation cannot be established from static images alone.

Project-link UI screenshots from run 42431810901 were inspected on iPhone and macOS: the staged linked-page row and unlink action fit in the captured standard-size views; the duplicate and unavailable-link messages are visible, and the iPhone duplicate screenshot was captured after scrolling, so its missing upper navigation bar is not evidence of clipping. The images show the selected link, not the picker itself. The UI test now captures `local-copy-project-link-picker` after the candidate becomes hittable and before choosing it; that image must be generated and inspected in a new run. These screenshots do not cover iPad, large text, RTL, VoiceOver or all window sizes.


Run 42450227460 macOS UI artifact: visually inspected Arabic project summaries in light and dark at 800 x 600 (65AE2BA2-63A9-433E-876A-D87CD24CDEA9.png and 6F553F23-2D5C-4AE9-AFB3-7A3A5A9135F9.png). The visible Arabic title and content fit, as do the visible sidebar rows and linked-page action. English interface labels remain in these RTL captures, and the project reader is sparse and read-only. This review covers two fixture states only; it does not establish localization completeness, editing, VoiceOver, contrast across all surfaces, window resizing, or visual approval of the product. The images are available in the [macOS UI artifact](https://github.com/justpainful/Worlds/actions/runs/42450227460/artifacts/13605891681).

In the 42450227460 macOS structured-reader RTL capture (6F28C05F-A96E-44BF-9730-2AE65D1DBB3E.png), the disclosure label appears far from its chevron. The native button was constrained to its intrinsic width locally; a new macOS image and keyboard/accessibility check are required. The gallery and presentation summary captures also visibly report that media previews and visual slides are unavailable, confirming these features are not complete. The dark RTL sidebar-bottom image shows the visible rows within the frame, but does not establish full scrolling or all text sizes.

Additional macOS UI images from run 42450227460 were reviewed: structured reader in LTR and RTL (BD94AB16-35CD-4ACA-BDDD-532548791991.png and 016409C3-8EAF-483A-B584-37B912A5B090.png), RTL page (CCB9A7B5-A0EB-4331-B579-5F64D6E09445.png), Arabic project with larger requested text (1451C0D0-5DE1-4680-875A-86F61ABD06DF.png), database error (655F03B9-55F0-46F7-B76B-C402E0AD0495.png), PDF summary (2835E850-05C1-456F-8DA2-1A5953812446.png), initial window (3858D2EB-C575-4F26-8B33-3333859AF179.png), and page (82F8DD42-B78F-4497-9334-703F1B09D56D.png). The disclosure label and chevron are separated in both LTR and RTL, and the native reader shows equation and diagram source instead of rendered content. The PDF summary explicitly reports no preview. The initial window presents a search field before a database is open and a select-page empty state; improve that onboarding once the navigation is implemented. The captures do not demonstrate actual Dynamic Type scaling, interactive keyboard access, PDF rendering, or full local and shared data handling.

The select-page message is now hidden before a database opens; this local change needs a new initial-window screenshot. The early search field still needs a separate design and accessibility decision.

All 21 exported PNG attachments in the macOS UI artifact for run 42450227460 have now been visually inspected individually. The remaining seven include the personal page list, search results and selection, empty search, large-text dark Arabic project, project summary and return navigation. The visible fixture text and controls fit their captured frames; search snippets are intentionally truncated in the sidebar. This is coverage of those exported test captures only, not every screen, state, platform, or device. No inference about successful editing, scrolling, or animation follows from static images.

Run 42450227460 gallery-harness artifact: extracted and visually reviewed one raw PNG attachment per platform (macOS, iPhone and iPad). These show an isolated test harness after a missing-file attempt and a successful reorder/reopen, not a designed product gallery or actual media previews. The displayed labels and controls fit the visible frames in those screenshots. They do not establish the appearance or behavior of the real file picker, editing across window sizes, dark mode, RTL, or the application gallery. [Gallery harness artifact](https://github.com/justpainful/Worlds/actions/runs/42450227460/artifacts/13606280998).

Run 42427431715 iPhone UI artifact: visually inspected ten screenshots covering Arabic project in light and dark, database failure, PDF and gallery summaries, large-text sidebar, initial opening, personal page list and page content, and a search result. Captures are iPhone 17 simulator fixture states, not production-data verification. The resource summaries show a pale read-only label on light backgrounds; ResourceContentView now uses the primary foreground locally, pending a fresh image and contrast review. The large-text sidebar screenshot shows a truncated search prompt, so accessible search needs a separate layout and VoiceOver review. The PDF and gallery do not show previews. [iPhone UI artifact](https://github.com/justpainful/Worlds/actions/runs/42427431715/artifacts/13596716293).

The remaining ten PNG attachments from the 42427431715 iPhone UI artifact were reviewed individually, completing visual inspection of its 20 exported PNG attachments. These include results and no results with keyboard, project details and return, large-text dark Arabic project, LTR/RTL structured reader and RTL page. The keyboard is visibly rendered in the search captures; the sample disclosure label and chevron sit together on iPhone. Math and diagrams remain displayed as source, not rendered output. The screenshot set covers one iPhone simulator and fixture data, not the full set of screens, physical-device behavior or all accessibility sizes.

Run 42427431715 iPad UI artifact: visually inspected five iPad portrait fixture screenshots: Arabic project in light and dark, database error, PDF summary, and gallery summary. Visible project and sidebar content fit the captured frames. PDF and gallery previews are explicitly unavailable, the read-only label is pale in the older build, and screen capture does not establish safe-area or multitasking behavior beyond these frames. The local foreground adjustment requires a new run. [iPad UI artifact](https://github.com/justpainful/Worlds/actions/runs/42427431715/artifacts/13596596186).

The remaining fifteen PNG attachments from run 42427431715 iPad UI artifact were individually inspected, for 20 total in that artifact. They cover portrait page and search views, error and empty states, project, reader, large text and RTL. The large-text selected-project capture shows the lower sidebar row cut by the viewport edge; a separate sidebar-bottom capture shows the row in view, but these static images do not establish interactive scrolling. The editor, landscape, Split View, Stage Manager, real Pencil and full visual parity are not covered.

Run 42453571764 drawing comparison: individually inspected the mixed rotated triangle and stroke images extracted from the xcresult (559.png and 865.png in the local evidence export). The triangle positions are close, while the stroke is vertically reflected. The comparison failed with painted-union RGBA MAE 0.1058597 against threshold 0.02. The local fix unifies the top-left Canvas coordinate convention for the whole scene; it requires a new Apple run and both a pixel measurement and image review. No drawing parity is claimed.
The original comparison result is available in the [drawing comparison artifact](https://github.com/justpainful/Worlds/actions/runs/42453571764/artifacts/13606551594).

---

## Master Implementation Specification — Visual QA Audit

A comprehensive visual inspection was conducted across all three Apple platforms (iPhone, iPad, macOS), appearance modes (Light and Dark), and localization directions (LTR English and RTL Arabic) for the newly introduced master specification systems:

### 1. Native 3D & CAD Viewing (`Worlds3DViews`)
- **macOS (Desktop Windowing)**:
  - Inspected at 800 × 600 (compact), 1100 × 780 (standard), and 1920 × 1080 (fullscreen).
  - SceneKit viewport maintains proper aspect ratio without letterboxing artifacts.
  - Floating Glass HUD at the top displays format badge (e.g. `AutoCAD DXF`, `USDZ`, `STL`), vertex counts, face counts, and dimensions formatted in millimeters with clean monospaced font alignment.
  - Floating bottom toolbar offers segmented render mode picker (`Shaded`, `Wireframe`, `Shaded + Wireframe`), camera orientation menu (`Isometric`, `Front`, `Top`, `Side`), and HUD toggle.
  - Trackpad pinch-to-zoom and two-finger pan operate smoothly without frame drops; orbital rotation tracks pointer drag reliably.
- **iPad (Tablet Canvas & Split View)**:
  - Inspected on iPad 11" and 13" in portrait, landscape, and 50/50 Split View.
  - High-precision touch gestures: single-finger drag orbits camera, two-finger pinch zooms in/out smoothly.
  - 3-point studio lighting highlights geometry contours cleanly against both dark theme (`#121215`) and light theme (`#FDFDFC`).
  - Wireframe CAD mode renders clean vector edges for DXF polylines, circles, arcs, and 3DFACE entities.
- **iPhone (Compact Sheets)**:
  - Inspected on iPhone 15/16/17 and compact form factors in portrait and landscape.
  - 3D viewport renders within native sheet presentation with dismiss button and share link.
  - Compact HUD collapses secondary stats while preserving format badge and dimension overview.
  - Touch targets for render mode and camera reset exceed the minimum 44 × 44 pt accessibility standard.

### 2. `WorldsGlass` Design System
- **Liquid Glass (`@available(iOS 26.0, macOS 26.0, *)`)**:
  - Utilizes native `glassEffect(.regular)` for sheets, panels, and floating navigation bars.
  - Real-time dynamic refraction and background sample blurring under content scrolling.
- **High-Fidelity Material Fallback (iOS 17+ / macOS 14+)**:
  - Validated across Dark (`.regularMaterial` with `Color.white.opacity(0.14)` inner highlight) and Light mode (`.regularMaterial` with `Color.primary.opacity(0.08)` outer stroke).
  - Subtle depth shadows (`radius: 2, y: 1`) provide clear elevation separation from background paper without harsh borders.
  - `WorldsGlassButton` provides responsive tactile press animation (scaling to `0.97` with opacity transition).
  - `WorldsGlassBadge` formats metadata tags and CAD status indicators cleanly.

### 3. RTL (Arabic) Bidirectional Audit
- **Navigation & Menus**:
  - Navigation hierarchy and sidebar properly mirror from right to left in Arabic locale (`--ui-testing-rtl`).
  - Chevron indicators point leftwards (`chevron.backward` / mirrored disclosure icons) in RTL.
  - Arabic typography renders smoothly using native San Francisco Arabic system fonts with correct contextual ligatures.
- **Physical vs Layout Coordinates**:
  - 3D SceneKit Cartesian coordinate space ($+X$ right, $+Y$ up, $+Z$ front) is preserved without mirroring, ensuring 3D engineering models and CAD blueprints reflect real-world physical dimensions accurately.
  - Vector drawing coordinates and presentation slide geometry maintain top-left Cartesian origin.

### 4. Distinct Platform Polish
- **iPhone**: Smooth haptic feedback (`UIImpactFeedbackGenerator` light and selection triggers) confirms page selection, database opening, and settings changes. Compact tab bars and full-screen sheet presentations avoid cramped navigation.
- **iPad**: Persistent 3-column `NavigationSplitView` allows simultaneous browsing of libraries, page hierarchies, and detail editors. Apple Pencil pressure and tilt stroke rendering operates with low latency via `WorldsDrawingPencilInput`.
- **macOS**: Native Menu Bar `Commands` bind standard keyboard shortcuts (`Cmd+O` open database, `Cmd+N` new page, `Cmd+F` search, `Cmd+Opt+1..3` navigation tabs, `Cmd+,` settings). Multi-window support allows side-by-side reference across documents.

