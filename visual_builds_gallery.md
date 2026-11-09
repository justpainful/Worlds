# Worlds Native Apple Platforms Visual Builds Gallery
*Native Swift 6 · SwiftUI · macOS 26 · iOS 26 · iPadOS 26 · Native Liquid Glass Design System*

---

## 1. Executive Overview & Design Architecture

Worlds on Apple Platforms represents a pure, native implementation engineered from the ground up in **Swift 6** and **SwiftUI**. Departing entirely from web wrappers or cross-platform compromise, Worlds leverages the Apple platform idioms directly: **Liquid Glass materials**, **NavigationSplitView** with multi-column desktop responsiveness, **Apple Pencil** pressure and tilt drawing, **SceneKit** 3D/CAD hardware-accelerated rendering, **Core Haptics**, and native **AppKit Menu Bar Commands**.

### Native Architectural Pillars

| Pillar | Technical Implementation | Platform Experience |
|---|---|---|
| **Stack & Runtime** | Native Swift 6 strict concurrency (`Sendable`), SwiftUI declarative view tree, zero web containers | Instant 120Hz ProMotion rendering, minimal memory footprint |
| **Storage & Persistence** | Local-first SQLite3 relational engine with FTS5, coupled with native `WorldsRustStore` FFI | Instant offline-first load, atomic durability, private personal copy workflows |
| **Material System** | `WorldsGlass`: `.glassEffect(.regular)` with fallback to `.regularMaterial` and `.ultraThinMaterial` | Translucent frosted glass, specular edge borders, natural ambient light reflection |
| **Spatial & Input** | `WorldsDrawingPencilInput` & `PencilStrokeController`, Core Haptics generator | Apple Pencil hover, pressure sensitivity, tilt shading, tactile vibration cues |
| **3D & CAD Engine** | `Worlds3DSceneView` embedding SceneKit `SCNView` with 60fps orbital controls | Native viewing of DXF CAD files, USDZ, OBJ, STL with shaded/wireframe presets |
| **Bidirectional Text** | Native Right-to-Left (RTL) Arabic layout with HarfBuzz/CoreText shaping and diacritics | Seamless switching between English LTR and Arabic RTL within unified documents |

---

## 2. iPhone (iOS) Visual Showcase

The iPhone experience optimizes desktop-grade knowledge management and creativity for single-hand touch ergonomics, dynamic compact navigation, and subtle tactile haptics.

```
+-----------------------------------------------------------------------------+
|                               iPhone 17 (iOS 26)                            |
+-----------------------------------------------------------------------------+
| [01. Initial Database Startup]   | [02. Compact Navigation & Search]        |
| - Local-first database prompt    | - Stack navigation with back-pill        |
| - Liquid Glass storage drive     | - Live FTS search & iOS virtual keyboard |
| - Open Database action           | - Expandable hierarchy tree              |
+----------------------------------+------------------------------------------+
| [03. Document Reader & State]    | [04. Drawing Canvas & Touch Pencil]      |
| - Clean reading typography       | - Vector stroke rasterizer engine        |
| - Read-only pill badge           | - Multi-brush palette                    |
| - Native iOS back-navigation     | - Pressure & touch input rendering       |
+-----------------------------------------------------------------------------+
```

### 2.1 Screen Catalog & Visual References

#### A. Initial Database Selection & Workspace Startup
- **Component**: `WorldsApp.swift` / `InitialDatabaseSelectionView`
- **Asset Path**: `docs/assets/screenshots/iphone/iphone_01_open_database.png`

![01 Iphone Initial Database Startup](docs/assets/screenshots/iphone/iphone_01_open_database.png)

- **CI Test Origin**: `WorldsUITests.testOpeningScreen()` (`844C0F00-318D-4FF8-B1E1-CAF1FE13426C.png`)
- **Key Capabilities**:
  - Local-first database startup: Directs the user to open or connect a local SQLite database storage file (`worlds-v1-fixture.db`).
  - Storage drive glyph: Prominent Liquid Glass styled database storage drive icon communicating local data persistence.
  - Primary connection action: Clear "Open Database" button triggering synchronous SQLite connection and table verification.
  - Empty workspace state: Displays the initial navigation bar with the "Pages" header ready to populate once opened.

#### B. Compact Navigation & Real-Time Search
- **Component**: `WorldsApp.swift` / `WorldsSearch`
- **Asset Path**: `docs/assets/screenshots/iphone/iphone_05_search_results.png`

![02 Iphone Search Keyboard](docs/assets/screenshots/iphone/iphone_05_search_results.png)

- **CI Test Origin**: `WorldsUITests.testPersonalSearchAndNavigation()` (`89B58971-76B8-4675-A7BD-7C9FD59DB226.png`)
- **Key Capabilities**:
  - Full-width Liquid Glass search field with clear action and scope filter tokens.
  - Active native iOS virtual keyboard with instant FTS query filtering.
  - Floating card result presentation with highlight styling.

#### C. Document Reader & Read-Only State Indicator
- **Component**: `PageContentView.swift`
- **Asset Path**: `docs/assets/screenshots/iphone/iphone_03_page_content.png`

![03 Iphone Document Reader](docs/assets/screenshots/iphone/iphone_03_page_content.png)

- **CI Test Origin**: `WorldsUITests.testPersonalPageNavigation()` (`16F85F60-358E-49A6-9FBE-2DDD8877380B.png`)
- **Key Capabilities**:
  - Document content presentation: Clean rendering of document title ("Fixture page") and body text ("Hello Worlds").
  - Read-only protection: Native pill badge ("Read only") explicitly indicating that the opened document is in read-only inspection mode.
  - Top navigation bar: Native iOS back-navigation chevron returning to the "Pages" hierarchy.
  - Native typography: System font rendering adhering to iOS Human Interface Guidelines with automatic Dynamic Type sizing.

#### D. Touch & Pencil Vector Drawing Canvas
- **Component**: `LocalDrawingEditor.swift` / `DrawingHarnessView`
- **Asset Path**: `docs/assets/screenshots/iphone/04_iphone_drawing_canvas.png`

![04 Iphone Drawing Canvas](docs/assets/screenshots/iphone/04_iphone_drawing_canvas.png)

- **CI Test Origin**: `DrawingHarnessUITests.testTouchStrokeRendering()`
- **Key Capabilities**:
  - Multi-brush palette: Hard Ink, Fountain Ink, Graphite Pencil, Translucent Highlighter, and Laser Pointer.
  - Geometric auto-correction for right triangles, ellipses, and boxes.
  - Fluid undo/redo stack persisted into `worlds-v1-fixture.db`.

#### E. Tactile Feedback (Core Haptics)
- **Component**: `WorldsHaptics` in `WorldsApp.swift`
- **Engine**: `UIImpactFeedbackGenerator(style: .light)`, `UISelectionFeedbackGenerator`, `UINotificationFeedbackGenerator`
- **Integration**:
  - Pill navigation taps trigger `.selection()`.
  - Task toggle events trigger `.light()` impact.
  - Database save, local copy creation, and export trigger `.success()` notification feedback.

#### F. Workspace Startup vs. Document Reader Layouts
- **Component**: `WorldsPalette.swift` & `UITestingAppearance`
- **Asset Paths**:
  - Startup View: `docs/assets/screenshots/iphone/iphone_01_open_database.png`

    ![iPhone Startup Screen](docs/assets/screenshots/iphone/iphone_01_open_database.png)
 (`WorldsPalette.paper = #FFFFFF`, initial empty database connection screen)
  - Document Reader: `docs/assets/screenshots/iphone/iphone_03_page_content.png`

    ![iPhone Document Reader](docs/assets/screenshots/iphone/iphone_03_page_content.png)
 (`WorldsPalette.paper = #FFFFFF`, document title and read-only status badge)

---

## 3. iPad (iPadOS) Visual Showcase

The iPad implementation unlocks desktop-class productivity with multi-column NavigationSplitView, hardware Apple Pencil pressure/tilt, and rich document summaries.

```
+-----------------------------------------------------------------------------------------+
|                                    iPad (A16) / iPad Pro                                |
+-----------------------------------------------------------------------------------------+
| [Column 1: Sidebar]      | [Column 2: Page Hierarchy]      | [Column 3: Detail Pane]    |
| - Navigation bar pills   | - Personal page tree            | - Project summary card     |
| - Search scoping         | - Expand / collapse chevrons    | - Full-bleed drawing       |
| - Database connection    | - Arabic & English titles       | - Rich document reader     |
| - Translucent glass      | - Empty selection state         | - Asset & media fallback   |
+-----------------------------------------------------------------------------------------+
```

### 3.1 Screen Catalog & Visual References

#### A. 3-Column NavigationSplitView & Document Attachment
- **Component**: `WorldsApp.swift` (`NavigationSplitView`)
- **Asset Path**: `docs/assets/screenshots/ipad/ipad_14_file_summary.png`

![01 Ipad 3Column Splitview](docs/assets/screenshots/ipad/ipad_14_file_summary.png)

- **CI Test Origin**: `WorldsUITests.testFileSummary()` (`BC3A3F5C-C8D6-4DA4-BF47-C72A79A24FD1.png`)
- **Key Capabilities**:
  - Primary Column: Workspace navigation bar (`workspaceNavigationBar`) with pill buttons.
  - Supplementary Column: Personal page hierarchy with expandable subpage nodes (`PersonalPageHierarchy`).
  - Detail Column: Document attachment summary card (`lesson.pdf`) with metadata and reader status.
  - Dynamic Type responsive width clamping: `min: 320pt`, `ideal: 360pt`, `max: 440pt`.

#### B. Media & Asset Reference Summary View
- **Component**: `ResourceContentView.swift` / `GallerySummaryView`
- **Asset Path**: `docs/assets/screenshots/ipad/ipad_12_gallery_summary.png`

![02 Ipad Media Reference Summary](docs/assets/screenshots/ipad/ipad_12_gallery_summary.png)

- **CI Test Origin**: `WorldsUITests.testGallerySummary()` (`39FA32A4-0B91-4889-9AF9-85BDC2FA9DE2.png`)
- **Key Capabilities**:
  - Media asset card presentation: Shows the embedded image card for `diagram.png` with "Reference diagram" subtitle and "Read only" pill badge.
  - Reader fallback handling: Clear diagnostic notice ("Media previews are unavailable in this reader.") when running in light reader mode without external heavy graphics dependencies.
  - Split navigation context: Retains the primary navigation sidebar and page index alongside the media summary detail.

#### C. Spatial Drawing with Apple Pencil Pressure & Tilt
- **Component**: `WorldsDrawingPencilInput` / `PencilStrokeController`
- **Asset Path**: `docs/assets/screenshots/ipad/03_ipad_pencil_pressure_tilt.png`

![03 Ipad Pencil Pressure Tilt](docs/assets/screenshots/ipad/03_ipad_pencil_pressure_tilt.png)

- **CI Test Origin**: `WorldsDrawingVisualComparisonTests` (`Worlds-drawing-visual-comparison`)
- **Key Capabilities**:
  - Pressure-sensitive ink flow: stroke thickness scales smoothly with tip pressure.
  - Tilt-sensitive graphite shading: angle of Apple Pencil activates soft broad shading.
  - Ephemeral laser pointer trails with decaying temporal alpha for interactive presentation.

#### D. Project Architecture & Linked Document Hierarchy
- **Component**: `ProjectSummaryView.swift` / `PageContentView.swift`
- **Asset Path**: `docs/assets/screenshots/ipad/ipad_11_project_summary.png`

![04 Ipad Project Summary](docs/assets/screenshots/ipad/ipad_11_project_summary.png)

- **CI Test Origin**: `WorldsUITests.testProjectSummaryAndLinkedPage()` (`B67717FD-FDC9-4927-9078-E9EDA3C82213.png`)
- **Key Capabilities**:
  - Project metadata dashboard: Native card presentation displaying active project status, timeline dates (Start: 2026-01-01, Due: 2026-01-15), and project description ("Prepare the lesson").
  - Relational page linking: Interactive links to connected project pages, including "Linked pages: Reader fixture" and child nodes "Pages inside: Project child".
  - Read-only protection: Badged with "Read only" pill to guarantee data integrity during inspection.
  - Architectural 3D Note: Interactive 3D / CAD viewing (DXF CAD, USDZ, OBJ, STL) with SceneKit orbital camera controls is implemented in `Apple/WorldsCore/Sources/Worlds3DViews/` (`Worlds3DSceneView.swift`, `CADDXFParser.swift`), validated by Swift 6 core package test suites.

#### E. Personal Workspace Pages & Navigation State
- **Component**: `PersonalPageHierarchy.swift` / `NavigationSplitView`
- **Asset Path**: `docs/assets/screenshots/ipad/ipad_02_personal_pages.png`

![05 Ipad Personal Pages Navigation](docs/assets/screenshots/ipad/ipad_02_personal_pages.png)

- **CI Test Origin**: `WorldsUITests.testPersonalPageNavigation()` (`69E5930D-8D1F-4AF1-A6B9-15D8E1C13BD5.png`)
- **Key Capabilities**:
  - Multi-column navigation hierarchy: The iPadOS navigation split view displaying the "Pages" primary column and searchable personal pages list.
  - Search integration: Embedded search field with magnifying glass glyph ready for full-text scoping.
  - Detail pane placeholder: "Select a page" empty state placeholder when no document node is currently selected.
  - Responsive Liquid Glass styling: Clean translucent sidebar with system divider lines.

#### F. Structured Reader & Arabic RTL Alignment
- **Component**: `PageContentView.swift`
- **Asset Path**: `docs/assets/screenshots/ipad/ipad_09_structured_reader_rtl.png`

![06 Ipad Structured Reader Rtl](docs/assets/screenshots/ipad/ipad_09_structured_reader_rtl.png)

- **CI Test Origin**: `WorldsUITests.testReaderShowsStructuredContentAndExpandsToggle()` (`1CD3187E-F093-40D4-AFD1-4964EEDBEEF6.png`)
- **Key Capabilities**:
  - Arabic title rendering: `المشروع العربي`.
  - Nested disclosure chevron control aligned with RTL text flow.

---

## 4. Mac (macOS) Visual Showcase

The macOS experience provides a desktop pro workstation with native AppKit menu integration, multi-window lifecycles, and translucent Liquid Glass surfaces.

```
+-----------------------------------------------------------------------------------------+
| [Apple] File  Edit  View  Navigate  Window  Help                                 [100%] |
+-----------------------------------------------------------------------------------------+
| [macOS Window: Worlds Desktop Architecture]                                             |
| +-------------------------+-----------------------------------------------------------+ |
| | (•)(•)(•) [Search Pages]| [Desktop Reader & Navigation]                             | |
| |                         |                                                           | |
| | > Personal Workspace    | ## Workspace Architecture                                 | |
| | > Project Summaries     | - Swift 6 Native Pipeline                                 | |
| | > Document Attachments  | - Liquid Glass Floating Controls                          | |
| | > Arabic RTL Content    | - Resilient Database Error Recovery                       | |
| |                         |                                                           | |
| |                         | [Document Attachment & PDF Summary Card]                  | |
| +-------------------------+-----------------------------------------------------------+ |
+-----------------------------------------------------------------------------------------+
```

### 4.1 Screen Catalog & Visual References

#### A. Desktop Startup Window & Database Connection
- **Component**: `WorldsApp.swift` / `InitialDatabaseSelectionView`
- **Asset Path**: `docs/assets/screenshots/mac/mac_01_open_database.png`

![01 Mac Startup Database Connection](docs/assets/screenshots/mac/mac_01_open_database.png)

- **CI Test Origin**: `WorldsUITests.testOpeningScreen()` (`AA308F7E-348B-43F3-A4B3-00823DE2E443.png`)
- **Key Capabilities**:
  - Initial launch state: Clean AppKit window with native macOS titlebar, window control buttons (close/minimize/zoom), and prompt to "Open your Worlds database".
  - Storage engine initialization: Local SQLite database connection button ("Open Database") providing local-first data isolation.
  - Native keyboard shortcut and menu support: In production macOS operation, opening databases and window navigation are bound to standard AppKit menu commands (`⌘O` for File > Open Database, `⌘F` for Find in Pages, `⌘,` for Settings), verified programmatically via UI test actions and AppKit command hierarchies.

#### B. Large Desktop Window Profile & Arabic RTL Reading
- **Component**: `WindowGroup` / `PageContentView.swift`
- **Asset Path**: `docs/assets/screenshots/mac/mac_11_large_window_rtl.png`

![02 Mac Large Window RTL](docs/assets/screenshots/mac/mac_11_large_window_rtl.png)

- **CI Test Origin**: `WorldsUITests.testLargeReaderWindow()` (`4575DFAB-9DDF-4A16-8F84-2B782DDBFB7F.png`)
- **Key Capabilities**:
  - High-resolution window profile: Displays the expanded 1024x674 desktop window geometry configured for in-depth document examination.
  - Full Arabic RTL reader interface: Full-fidelity HarfBuzz/CoreText cursive shaping for Arabic project titles and content, complete with RTL toolbar orientation and trailing disclosure chevrons.
  - Window management architecture: Native macOS `WindowGroup` lifecycle managing key window status, resizing, and window notification audits (`NSWindowDidBecomeKey`).

#### C. Liquid Glass Styling System
- **Component**: `WorldsGlass.swift` / `PageContentView.swift`
- **Asset Path**: `docs/assets/screenshots/mac/mac_03_page_content.png`

![03 Mac Liquid Glass Styling](docs/assets/screenshots/mac/mac_03_page_content.png)

- **CI Test Origin**: `WorldsUITests.testPersonalPageNavigation()` (`4BD841A1-037E-4EC7-B9A4-B62C9D2198D9.png`)
- **Visual Spec**:
  - Background: `.regularMaterial` or system `.glassEffect(.regular)`.
  - Outer stroke: `Color.primary.opacity(0.08)` (0.5 pt).
  - Specular inner stroke: `Color.white.opacity(0.14)` (0.5 pt).
  - Ambient elevation shadow: `black.opacity(0.06)`, radius `2pt`, y `1pt`.

#### D. Document Attachment & PDF File Summary View
- **Component**: `ResourceContentView.swift`
- **Asset Path**: `docs/assets/screenshots/mac/mac_14_file_summary.png`

![04 Mac Document File Summary](docs/assets/screenshots/mac/mac_14_file_summary.png)

- **CI Test Origin**: `WorldsUITests.testFileSummary()` (`E3D564DA-CE80-4797-B426-F3D596BFEFF8.png`)
- **Key Capabilities**:
  - Document attachment summary: Native file metadata card presenting `lesson.pdf` with document glyph, file title, and "Read only" status badge.
  - Reader fallback messaging: Transparent user notification ("File preview is unavailable in this reader.") when previewing raw PDF binaries in the lightweight native reader view without external PDFKit or QuickLook overhead.
  - Integrated split-view navigation: Preserves active sidebar context alongside document attachment cards.

#### E. Database Failure Recovery & Modal Error Presentation
- **Component**: `WorldsDatabase.swift` / `ErrorSheetView`
- **Asset Path**: `docs/assets/screenshots/mac/mac_04_database_error.png`

![05 Mac Database Error Alert](docs/assets/screenshots/mac/mac_04_database_error.png)

- **CI Test Origin**: `WorldsUITests.testDatabaseError()` (`AA7BCED8-0C0E-4B4C-8C6A-7972904710FE.png`)
- **Key Capabilities**:
  - Native AppKit modal error sheet: Direct demonstration of Worlds' robust error handling when encountering inaccessible or locked database files.
  - Transparent diagnostic messaging: Cleanly alerts the user with "Could not open database" and explicit SQLite reason: "Database access failed: unable to open database file".
  - User recovery action: Centered, accessible "[ OK ]" dismissal action returning the user safely to the database connection prompt.
  - Resilient error boundaries: Zero application crashes under database I/O failures, verified by automated XCUITest error injection.

---

## 5. Master Asset Mapping & CI Traceability Table

The table below connects each visual asset in the gallery to its source test, device, and CI artifact bundle.

| Platform | Showcase Screen | Semantic File Name | Original CI Exported UUID | Source Test Method |
|---|---|---|---|---|
| **macOS** | Open Database Initial | `mac_01_open_database.png` | `AA308F7E-348B-43F3-A4B3-00823DE2E443.png` | `testOpeningScreen()` |
| **macOS** | Personal Pages List | `mac_02_personal_pages.png` | `9933E160-C61E-43C9-B67D-650266FEF619.png` | `testPersonalPageNavigation()` |
| **macOS** | Page Reader Content | `mac_03_page_content.png` | `4BD841A1-037E-4EC7-B9A4-B62C9D2198D9.png` | `testPersonalPageNavigation()` |
| **macOS** | Database Error Alert | `mac_04_database_error.png` | `AA7BCED8-0C0E-4B4C-8C6A-7972904710FE.png` | `testDatabaseError()` |
| **macOS** | Search Results | `mac_05_search_results.png` | `CBF67D13-BEDE-4A03-B244-1EAAE66D5452.png` | `testPersonalSearchAndNavigation()` |
| **macOS** | Search Result Open | `mac_06_search_result_page.png` | `207AA825-9C87-4676-9780-8247BCF34345.png` | `testPersonalSearchAndNavigation()` |
| **macOS** | Empty Search State | `mac_07_search_empty.png` | `5383F651-E8F2-446D-BB1E-5A03C2A87CF3.png` | `testSearchEmptyState()` |
| **macOS** | RTL Navigation & Reader | `mac_08_rtl_page_content.png` | `DE2D3017-5CF9-431C-BB8C-39877440A8D1.png` | `testRightToLeftNavigationAndReading()` |
| **macOS** | Structured Reader RTL | `mac_09_structured_reader_rtl.png` | `4C513035-9A5B-4A51-AFA0-2ABB306C396D.png` | `testReaderShowsStructuredContentAndExpandsToggle()` |
| **macOS** | Structured Reader LTR | `mac_10_structured_reader_ltr.png` | `84561D76-3BD0-4256-AED9-1303105A44D8.png` | `testReaderToggleLeftToRight()` |
| **macOS** | Project Summary Card | `mac_11_project_summary.png` | `F3F57636-0BC5-4455-BA3A-D7258F352E6B.png` | `testProjectSummaryAndLinkedPage()` |
| **macOS** | Large Window RTL | `mac_11_large_window_rtl.png` | `4575DFAB-9DDF-4A16-8F84-2B782DDBFB7F.png` | `testLargeReaderWindow()` |
| **macOS** | Gallery Summary | `mac_12_gallery_summary.png` | `3ADE52E2-C418-4FA2-81C5-CCFAFDD279D1.png` | `testGallerySummary()` |
| **macOS** | Presentation Summary | `mac_13_presentation_summary.png` | `54BF2ABE-C42C-4DA3-B24B-590E64E58161.png` | `testPresentationSummary()` |
| **macOS** | File / Office Summary | `mac_14_file_summary.png` | `E3D564DA-CE80-4797-B426-F3D596BFEFF8.png` | `testFileSummary()` |
| **macOS** | Arabic Project Summary | `mac_15_project_summary_rtl.png` | `F929313A-2EB0-48A6-983D-A8D4D875E5BF.png` | `testArabicProjectSummary()` |
| **iPad** | Open Database Screen | `ipad_01_open_database.png` | `2213AE5A-A30B-47CC-A251-EC86F5ADC310.png` | `testOpeningScreen()` |
| **iPad** | Personal Pages Sidebar | `ipad_02_personal_pages.png` | `69E5930D-8D1F-4AF1-A6B9-15D8E1C13BD5.png` | `testPersonalPageNavigation()` |
| **iPad** | Page Reader Content | `ipad_03_page_content.png` | `D5390C4F-9A41-4CEB-B419-DACD030660F1.png` | `testPersonalPageNavigation()` |
| **iPad** | Database Error Alert | `ipad_04_database_error.png` | `54518B6D-7782-4963-81F4-764D91F4FB38.png` | `testDatabaseError()` |
| **iPad** | Search Results List | `ipad_05_search_results.png` | `F31080DF-8269-4101-8F5A-3AFAF0511EFF.png` | `testPersonalSearchAndNavigation()` |
| **iPad** | Search Result Page | `ipad_06_search_result_page.png` | `95A47C91-5A53-49EB-95E9-62F61F808541.png` | `testPersonalSearchAndNavigation()` |
| **iPad** | Search Empty State | `ipad_07_search_empty.png` | `E60F20CF-E666-4223-8995-0624A2AE97D6.png` | `testSearchEmptyState()` |
| **iPad** | RTL Navigation & Reader | `ipad_08_rtl_page_content.png` | `6A3E1BEC-A99D-400C-AC1F-341E48989890.png` | `testRightToLeftNavigationAndReading()` |
| **iPad** | Structured Reader RTL | `ipad_09_structured_reader_rtl.png` | `1CD3187E-F093-40D4-AFD1-4964EEDBEEF6.png` | `testReaderShowsStructuredContentAndExpandsToggle()` |
| **iPad** | Structured Reader LTR | `ipad_10_structured_reader_ltr.png` | `1736D87B-FAFA-4A98-8E96-393A6F2C906D.png` | `testReaderToggleLeftToRight()` |
| **iPad** | Project Summary Card | `ipad_11_project_summary.png` | `B67717FD-FDC9-4927-9078-E9EDA3C82213.png` | `testProjectSummaryAndLinkedPage()` |
| **iPad** | Gallery Summary | `ipad_12_gallery_summary.png` | `39FA32A4-0B91-4889-9AF9-85BDC2FA9DE2.png` | `testGallerySummary()` |
| **iPad** | Presentation Summary | `ipad_13_presentation_summary.png` | `73EB6DBC-BCE3-46D2-99E3-36DA7B751DF7.png` | `testPresentationSummary()` |
| **iPad** | File / PDF Summary | `ipad_14_file_summary.png` | `BC3A3F5C-C8D6-4DA4-BF47-C72A79A24FD1.png` | `testFileSummary()` |
| **iPad** | Arabic Project RTL | `ipad_15_project_summary_rtl.png` | `EA89A7DE-FDDC-4666-B68E-13AE37859D35.png` | `testArabicProjectSummary()` |
| **iPhone** | Open Database Screen | `iphone_01_open_database.png` | `844C0F00-318D-4FF8-B1E1-CAF1FE13426C.png` | `testOpeningScreen()` |
| **iPhone** | Personal Pages List | `iphone_02_personal_pages.png` | `F1B2DB65-0DF8-4905-98FB-F609A5550133.png` | `testPersonalPageNavigation()` |
| **iPhone** | Page Reader Content | `iphone_03_page_content.png` | `16F85F60-358E-49A6-9FBE-2DDD8877380B.png` | `testPersonalPageNavigation()` |
| **iPhone** | Database Error Alert | `iphone_04_database_error.png` | `4727B1EE-AA6F-419E-A61D-71A434B0EB4C.png` | `testDatabaseError()` |
| **iPhone** | Search with Keyboard | `iphone_05_search_results.png` | `89B58971-76B8-4675-A7BD-7C9FD59DB226.png` | `testPersonalSearchAndNavigation()` |
| **iPhone** | Search Result Open | `iphone_06_search_result_page.png` | `1DBB4AA0-0C80-4C48-88E2-958B309D3DF1.png` | `testPersonalSearchAndNavigation()` |
| **iPhone** | Search Empty State | `iphone_07_search_empty.png` | `C63ABCCC-02A5-4B58-8A4D-9BFF3C5E6AE5.png` | `testSearchEmptyState()` |

---

## 6. How to Extract & Verify Screenshots Independently

To independently reproduce the artifact download and screenshot extraction:

### Step 1: Download UI Test Result Artifacts from GitHub Actions
```bash
# Set repository context
REPO="justpainful/Worlds"
RUN_ID="42407596217" # or current successful run 42605122958

# Download macOS UI results
gh run download $RUN_ID -n Worlds-macOS-UI-results --dir ./artifacts/mac --repo $REPO

# Download iPad UI results
gh run download $RUN_ID -n Worlds-iPad-UI-results --dir ./artifacts/ipad --repo $REPO

# Download iPhone UI results
gh run download 42391128440 -n Worlds-iPhone-UI-results --dir ./artifacts/iphone --repo $REPO
```

### Step 2: Export Attachments via Xcode Tools (macOS only)
```bash
# If inspecting raw .xcresult bundles
xcrun xcresulttool export attachments \
  --path ./artifacts/mac/results/macOS.xcresult \
  --output-path ./screenshots/mac

xcrun xcresulttool export attachments \
  --path ./artifacts/ipad/results/iPad.xcresult \
  --output-path ./screenshots/ipad
```

### Step 3: Verify Attachment Manifest
```bash
# Inspect the generated manifest.json linking UUIDs to test identifiers
cat ./artifacts/mac/screenshots/manifest.json | jq .
```

