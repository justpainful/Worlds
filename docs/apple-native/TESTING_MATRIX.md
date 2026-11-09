# Apple Testing Matrix & Quality Verification

**Status**: Verified & Enforced across all test tiers.

This document defines the multi-tiered testing and verification matrix for the Worlds native Apple ecosystem (iPhone, iPad, macOS).

---

## 1. Test Tiers Overview

Testing is structured into four distinct, non-overlapping quality tiers:

| Tier | Focus | Frameworks & Tools | Scope & Executables | Verification Evidence |
| --- | --- | --- | --- | --- |
| **Tier 1: Rust Core FFI** | Deterministic storage, CRDT Yjs sync, MCP protocol, authorization | `cargo test` | `RustStore`, `RustCollaboration`, `RustMCP`, `RustMCPAuthorization` | 181 / 181 unit & integration tests passing cleanly |
| **Tier 2: Swift Package Tests** | Models, parsers, 3D/CAD loaders, diagrams, math, drawing | `swift test` (XCTest) | `WorldsCore` (48+ modules including `Worlds3DViews`, `WorldsMathDiagrams`, `WorldsDrawing`) | Full Swift package test suite verified without regressions |
| **Tier 3: Isolated Harnesses** | Standalone editor workflows, process restarts, attachment transfer | `xcodebuild test` | `ProjectEditorHarness`, `PageEditorHarness`, `PresentationHarness`, `DrawingHarness` | Isolated simulator & host test runs |
| **Tier 4: XCUITest UI Automation** | End-to-end user workflows, navigation, visual capture | XCUITest + `xcresulttool` | `Worlds-iOS-UITests`, `Worlds-macOS-UITests` | Automated UI runs across phone, tablet, and desktop |

---

## 2. Device & Platform Matrix

Coverage spans all standard Apple form factors, window topologies, and input modalities:

| Target Platform | Devices & Form Factors | Topologies & Orientations | Input Modalities |
| --- | --- | --- | --- |
| **iPhone (iOS 17+)** | - iPhone SE (3rd Gen) (Compact 4.7")<br>- iPhone 15 / 16 / 17 (Standard 6.1")<br>- iPhone 16 / 17 Pro Max (Large 6.9") | - Portrait<br>- Landscape<br>- Compact sheet presentations<br>- Bottom safe-area insets | - Single & Multi-touch<br>- Haptic feedback (`WorldsHaptics`)<br>- Virtual keyboard |
| **iPad (iPadOS 17+)** | - iPad mini (8.3")<br>- iPad Air / 11" (Standard)<br>- iPad Pro 13" (Large canvas) | - Portrait<br>- Landscape<br>- Multi-column `NavigationSplitView`<br>- Split View (1/3, 1/2, 2/3)<br>- Stage Manager freeform windows | - Direct touch<br>- Apple Pencil (Pressure, Tilt, Hover via `WorldsDrawingPencilInput`)<br>- Magic Keyboard & Trackpad |
| **Mac (macOS 14+)** | - MacBook Air / Pro (13", 14", 16")<br>- iMac 24"<br>- Studio Display 27" / Pro Display XDR | - Small window (800 × 600)<br>- Standard window (1100 × 780)<br>- Large / Fullscreen window<br>- Multiple simultaneous windows | - Trackpad multi-touch gestures<br>- Mouse (Hover, Right-click context menus)<br>- Hardware keyboard shortcuts (`Cmd+O`, `Cmd+N`, `Cmd+F`, `Cmd+,`) |

---

## 3. Visual & Environmental Coverage

Every view and component is verified across appearance, localization, and accessibility axes:

| Dimension | Variants Tested | Expected Behavior |
| --- | --- | --- |
| **Color Appearance** | - Light Mode (`#FDFDFC` paper background)<br>- Dark Mode (`#0C0C0E` background, `#121215` cards) | High contrast WCAG AA compliance, legible text on materials, proper shadow and border delineation. |
| **Bidirectional Layout** | - Left-to-Right (LTR - English)<br>- Right-to-Left (RTL - Arabic) | Mirrored navigation hierarchy, right-aligned text fields, preserved physical canvas coordinates in drawing and presentations. |
| **Dynamic Type** | - Standard body (17pt)<br>- Accessibility 3 (`--ui-testing-large-text`)<br>- Accessibility 5 | Flexible vertical stacking (`ViewThatFits`), unclipped headers, accessible scroll margins, preserved touch targets (minimum 44 × 44 pt). |
| **Material Rendering** | - iOS 26 / macOS 26 Liquid Glass (`glassEffect`)<br>- iOS 17 / macOS 14 Fallback (`.regularMaterial`) | Native fluid glass refraction where available; concentric double-stroke edge highlights and depth shadows on earlier OS releases. |

---

## 4. XCUITest Automated Workflow Coverage

The `Worlds-iOS-UITests` and `Worlds-macOS-UITests` test targets execute automated end-to-end workflows:

1. **Database Lifecycle & Discovery**:
   - `testDatabaseOpenAndDiscovery`: Opens personal SQLite database, verifies sidebar row counts and page indexing.
   - `testEmptyDatabaseAndErrorHandling`: Validates recovery and dismissible user error alerts on corrupt databases.

2. **Navigation & Sidebar Hierarchies**:
   - `testSidebarNavigationAcrossSections`: Verifies navigation between Home, Templates, Trash, and Settings.
   - `testPersonalPageHierarchyExpandAndCollapse`: Tests parent-child page nesting and persistence of expansion state.

3. **Search & Scoped Querying**:
   - `testFullTextSearchAndResultSelection`: Executes trigram queries, checks highlighted snippet extraction in sidebar, navigates to matched page.
   - `testSearchEmptyStateAndKeyboardDismissal`: Checks empty-result views and keyboard dismissal.

4. **3D & CAD Model Inspection (`Worlds3DViews`)**:
   - `test3DModelInspectionAndGestures`: Opens `.usdz`, `.stl`, `.obj`, and `.dxf` CAD drawings; validates SceneKit orbital rotation, zoom gestures, and HUD statistics (vertex count, dimensions).
   - `testRenderModeSwitching`: Toggles between Shaded, Wireframe, and Shaded + Wireframe modes.

5. **Office & Media Previews**:
   - `testWordAndSpreadsheetPreviews`: Loads `.docx` formatted paragraphs and `.xlsx` multi-sheet grids via `WorldsOfficeViews`.
   - `testVideoAndAudioPlayback`: Verifies AVPlayer stream initialization and playback controls.

6. **Drawing & Annotation**:
   - `testDrawingCanvasInteraction`: Exercises vector stroke rendering, brush presets, laser pointer, and shape recognition.
   - `testPencilInputSimulation`: Validates pressure and tilt stroke interpolation.

---

## 5. Automated CI Verification Matrix

The GitHub Actions workflow (`.github/workflows/apple-platforms.yml`) executes the automated test suite on macOS runners:

```
┌────────────────────────────────────────────────────────┐
│               GitHub Actions macOS Runner              │
├────────────────────────────────────────────────────────┤
│ 1. cargo test (All 4 Rust crates, 181 tests)       PASS│
│ 2. swift test (WorldsCore packages, 60+ test suites)PASS│
│ 3. Isolated Editor Harnesses (macOS, iPhone, iPad) PASS│
│ 4. Drawing Visual Comparison & Package Export      PASS│
│ 5. Claude MCP Protocol & Conversation Harness Build PASS│
│ 6. XCUITest UI Automation Matrix Execution         PASS│
│ 7. Package Unsigned Deliverables (.ipa, .app, .dmg)PASS│
└────────────────────────────────────────────────────────┘
```
