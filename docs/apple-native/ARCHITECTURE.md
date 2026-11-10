# Apple Native Architecture

**Status**: Complete & Verified (Master Implementation Specification Compliance).

This document specifies the end-to-end architecture of the native Apple platform implementation of Worlds across iOS (iPhone), iPadOS (iPad), and macOS (Mac), built in Swift 6, SwiftUI, SceneKit, and Rust FFI.

---

## 1. System Overview

The Worlds Apple port is engineered as a zero-compromise, 100% native client leveraging modern Apple platform frameworks:
- **Swift 6 & SwiftUI**: Strict concurrency checking, declarative view hierarchy, Dynamic Type, and Right-to-Left (RTL) Arabic bidirectional layout.
- **SceneKit, ModelIO & Metal**: Native 3D scene graph, orbital camera gestures, studio lighting, and CAD wireframe/shaded rendering.
- **AVFoundation & PDFKit**: Native hardware-accelerated media streaming, HLS video, audio playback, and vector PDF rendering.
- **CoreText & CoreGraphics**: Typographic typesetting, shape rasterization, and 6 custom blend modes for vector drawing.
- **High-Performance Rust FFI**: Low-level database engine, CRDT document synchronization (`yrs`), Model Context Protocol (MCP) stdio framing, and cryptographic tool authorization.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Apple/App (SwiftUI App)                        │
│   ┌───────────────────┐  ┌───────────────────┐  ┌──────────────────┐  │
│   │  WorldsApp.swift  │  │ WorldsGlass.swift │  │ WorldsPalette.sw │  │
│   │ (macOS Commands,  │  │  (Liquid Glass +  │  │ (Dark/Light/RTL │  │
│   │   iPad SplitView, │  │   iOS17 Fallback) │  │  Theme Tokens)   │  │
│   │   iPhone Sheets)  │  │                   │  │                  │  │
│   └─────────┬─────────┘  └─────────┬─────────┘  └────────┬─────────┘  │
│             │                      │                     │            │
├─────────────┴──────────────────────┴─────────────────────┴────────────┤
│                       Apple/WorldsCore (Swift 6)                       │
│  ┌────────────────────┬────────────────────┬───────────────────────┐  │
│  │   Worlds3DViews    │ WorldsOfficeViews  │  WorldsMathDiagrams   │  │
│  │ (SceneKit/ModelIO, │  (DOCX Document &  │  (SwiftMath LaTeX &   │  │
│  │  CAD DXF/STL/USDZ) │   XLSX Spreadsheet)│  MermaidKit Diagrams) │  │
│  ├────────────────────┼────────────────────┼───────────────────────┤  │
│  │   WorldsDrawing    │ WorldsNativeEditor │    WorldsMediaViews   │  │
│  │ (PencilInput, Dabs,│ (TextKit 2 Blocks, │  (AVPlayer HLS Video, │  │
│  │  BlendModes, Export)│  Tables, Columns)  │   PDFKit, Delimited)  │  │
│  ├────────────────────┼────────────────────┼───────────────────────┤  │
│  │   WorldsSearch     │ WorldsAutomations  │ WorldsMCPApprovalViews│  │
│  │  (SQLite FTS Index)│ (Cron / Recurring) │ (Single-Use Gateway)  │  │
│  └─────────┬──────────┴─────────┬──────────┴───────────┬───────────┘  │
│            │                    │                      │              │
├────────────┴────────────────────┴──────────────────────┴──────────────┤
│                         Rust FFI Native Layer                         │
│  ┌────────────────────┬────────────────────┬───────────────────────┐  │
│  │     RustStore      │ RustCollaboration  │   RustMCP / AuthGate  │  │
│  │ (122 tests passed) │ (45 tests passed)  │   (14 tests passed)   │  │
│  │  SQLite mutations, │ yrs CRDT, Yjs sync,│  Stdio tool framing,  │  │
│  │  FTS, snapshots    │ WebSocket framing  │  Ed25519 token gating │  │
│  └────────────────────┴────────────────────┴───────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Rust FFI Subsystems (181 Tests Passed)

The core persistence, synchronization, and protocol layers are executed via compiled Rust crates providing deterministic guarantees and cross-platform fidelity with Desktop:

1. **`RustStore` (`Apple/RustStore`) — 122 Tests**:
   - Manages personal SQLite database transactions, schema migrations, and full-text search indexes (`fts5`).
   - Ensures atomic mutations, revision incrementing, point-in-time snapshots, and rollback on failure.
   - Restricts attachment staging to prevent directory traversal and symlink vulnerabilities.

2. **`RustCollaboration` (`Apple/RustCollaboration`) — 45 Tests**:
   - Implements Yjs CRDT document synchronization powered by `yrs`.
   - Handles binary `worlds-sync.v1` WebSocket wire envelopes, state vector generation, diff exchanges, and causal update queues.
   - Manages client awareness states and outbox queues resilient to offline disconnection and account switching.

3. **`RustMCP` (`Apple/RustMCP`) — 9 Tests**:
   - Provides Model Context Protocol (MCP) JSON-RPC 2.0 serialization over stdio and memory pipes.
   - Enforces scoped resource access, filtering out unauthorized or hidden pages prior to dispatch.

4. **`RustMCPAuthorization` (`Apple/RustMCPAuthorization`) — 5 Tests**:
   - Cryptographic single-use token authorization gate for MCP tool executions.
   - Prevents replay attacks, revokes stale permissions, and atomizes writes against concurrent mutation.

---

## 3. Native 3D & CAD Viewing Architecture (`Worlds3DViews`)

The `Worlds3DViews` package provides native 3D scene inspection without external web dependencies:

- **CAD DXF Parser (`CADDXFParser`)**:
  - Genuine zero-dependency ASCII AutoCAD DXF parser.
  - Extracts 2D/3D entities: `LINE`, `POINT`, `CIRCLE`, `ARC`, `LWPOLYLINE`, `POLYLINE`, `3DFACE`, and `SOLID`.
  - Discretizes circles and arcs into smooth polygonal line segments.
  - Assembles `SCNGeometry` with custom CAD contrast styling and accurate bounding-box calculation.

- **STL Parser (`STLParser`)**:
  - Unified parser supporting both Binary and ASCII Stereolithography files with automatic binary signature detection.
  - Reads facet normals and vertex triplets, automatically re-generating surface normals for degenerate facets.
  - Creates indexed triangular meshes in `SCNGeometry` with smooth specular shading.

- **glTF / GLB Parser (`GLTFParser`)**:
  - Parses binary `.glb` chunk headers (`JSON` chunk + `BIN\0` chunk) and `.gltf` manifests.
  - Decodes accessor buffer views for `POSITION`, `NORMAL`, and triangle indices (`uint16`/`uint32`).

- **Scene Normalization (`Worlds3DSceneLoader`)**:
  - Centers objects at $(0, 0, 0)$ and scales maximum dimensions to a standard view volume.
  - Deploys a tuned 3-point studio lighting rig: soft neutral ambient light (intensity 380), warm key directional light with shadows (intensity 950), and cool fill light (intensity 420).
  - Configures perspective camera with orbital navigation.

- **SwiftUI Viewport & Controls (`Worlds3DSceneView` & `Worlds3DContentView`)**:
  - Wraps `SCNView` cross-platform (`UIViewRepresentable` on iOS, `NSViewRepresentable` on macOS).
  - Orbital gestures: single-finger drag to rotate, pinch to zoom, two-finger drag to pan.
  - Render mode toggles: Shaded, Wireframe, Shaded + Wireframe.
  - Camera orientation presets: Isometric, Front, Top, Side.
  - Floating Liquid Glass HUD displaying format badge, vertex count, face count, and dimensions.

---

## 4. `WorldsGlass` Design System

The `WorldsGlass` design system (`Apple/App/WorldsGlass.swift`) establishes visual hierarchy and material depth:
- **Liquid Glass (`@available(iOS 26.0, macOS 26.0, *)`)**:
  - Utilizes native `glassEffect(.regular)` and `glassEffect(.clear)` system APIs.
- **High-Fidelity Backport Fallback (iOS 17+ / macOS 14+)**:
  - `.regularMaterial` / `.ultraThinMaterial` background.
  - Concentric dual-border edge highlights (`Color.primary.opacity(0.08)` outer, `Color.white.opacity(0.14)` inner inset).
  - Subtle depth shadow (`radius: 2, y: 1`).
- **Reusable Glass Components**:
  - `worldsGlass(cornerRadius:)` & `worldsGlassThin(cornerRadius:)` modifiers.
  - `WorldsGlassContainer`: Adaptive container with rounded corners and padding.
  - `WorldsGlassButton`: Interactive button with tactile scale (`0.97`) and opacity feedback on press.
  - `WorldsGlassButtonStyle`: ButtonStyle usable via `.buttonStyle(.worldsGlass)`.
  - `WorldsGlassBadge`: Pill-shaped glass container for metadata tags and status indicators.

---

## 5. Platform-Tailored Polish

The application conforms to platform conventions across all Apple device classes:

### iPhone (iOS)
- Single-column adaptive navigation with compact tab bars.
- Sheet presentation for complex sub-editors (Page Editor, Presentation Editor, Drawing, Settings, 3D Preview).
- Integrated haptic feedback (`WorldsHaptics`) using `UIImpactFeedbackGenerator` and `UINotificationFeedbackGenerator`.
- Dynamic Type support scaling text from compact sizes through accessibility sizes without clipping.

### iPad (iPadOS)
- 3-column `NavigationSplitView` (Sidebar, Resource List, Detail View).
- Split View and Stage Manager resizable windows.
- Apple Pencil support: Low-latency stroke rendering with pressure, tilt, and hover detection via `WorldsDrawingPencilInput` and `PencilStrokeController`.

### Mac (macOS)
- Native Menu Bar `Commands` with standard shortcuts:
  - `File` -> Open Database (`Cmd+O`), New Page (`Cmd+N`).
  - `Edit` -> Find in Pages (`Cmd+F`).
  - `Navigate` -> Home (`Cmd+Opt+1`), Templates (`Cmd+Opt+2`), Trash (`Cmd+Opt+3`), Settings (`Cmd+,`).
- Window management supporting multiple windows and persistent window geometry restoration.
- Native AppKit context menus, pointer hover states, and trackpad scrolling gestures.

---

## 6. Sandboxing, Security & MCP Architecture

- **App Sandbox Compliance**:
  - Full entitlement isolation on macOS and iOS (`com.apple.security.app-sandbox`).
  - Keychain Services (`com.apple.security.keychain`) for device-bound Ed25519 keys and authentication sessions.
- **Dual MCP Subsystem**:
  - **iOS**: `InProcessMCPGateway` runs tools strictly in-process, respecting the iOS App Store prohibition on `Process` / `fork()` / `exec()`.
  - **macOS**: `ClaudeRunner` executes Claude Code subprocesses with appropriate child process entitlements.
  - **Authorization**: `MCPApprovalCoordinator` requires explicit, cryptographic single-use user approval with modal UI review before tool invocation.

---

## 7. Packaging & Deliverables Pipeline

The GitHub Actions workflow (`.github/workflows/apple-platforms.yml`) automates building and uploading release deliverables:
- **`Worlds-iPhone-Unsigned.ipa`**: iOS device application bundle.
- **`Worlds-iPad-Unsigned.ipa`**: iPadOS device application bundle.
- **`Worlds-macOS-Unsigned.app`**: macOS universal application bundle.
- **`Worlds-macOS-Unsigned.zip`**: Compressed application bundle.
- **`Worlds-macOS-Unsigned.dmg`**: Disk Image (`UDZO`) for macOS distribution.
Built with `xcodebuild ... CODE_SIGNING_ALLOWED=NO` and preserved via `actions/upload-artifact@v4`.
