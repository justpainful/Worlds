# Android & ChromeOS Native Architecture

## 1. System Overview

Worlds for Android and ChromeOS is a fully native application built with Kotlin and Jetpack Compose. It runs across phones, tablets, foldables, and Chromebooks without relying on web wrappers, React, Flutter, or Electron.

The codebase is organized into five specialized modules under `Android/`:

```
Android/
├── app/                  # Main UI application, Compose screens, ViewModels, System integrations
├── core/
│   ├── content/          # SQLite content storage, document blocks, automations engine
│   ├── identity/         # Account auth, session tokens, encrypted storage, workspace permissions
│   ├── stylus/           # Low-latency pen engine, S Pen & USI pointer routing, palm rejection
│   └── sync/             # Collaborative replication, Yrs native engine (JNI/Rust), durable outbox
```

---

## 2. Core Architecture Layers

### Layer 1: Data & Persistence (`core:content` & `core:sync`)
- **Local SQLite Store (`ContentStore`)**:
  - Atomic document revisions, transactional CRUD, parent/subpage hierarchy, cycle checks.
  - Automations subsystem: trigger specifications, rule evaluation, and execution run history stored in SQLite (`automations`, `automation_runs`).
- **Synchronized Yjs Store (`core:sync`)**:
  - Native Rust Yrs library connected via JNI.
  - Multi-peer CRDT updates, collaborative cursors, offline edits, and durable outbox syncing via `WorkManager`.

### Layer 2: Stylus & Graphics Engine (`core:stylus` & `app/src/.../DrawingStore`)
- **`WorldsStylusEngine`**:
  - Direct `MotionEvent` sampling for Samsung S Pen, Galaxy Fold, and USI 2.0 Chromebook pens.
  - Hardware pressure sensitivity (4096 levels), tilt radians, orientation, hover cursor tracking, and eraser tail support.
  - Native palm rejection separating single-pointer active pen input from 2-finger pan/zoom touch gestures.
- **Multi-Layer Drawing Canvas**:
  - Multi-layer stack (`DrawingStore`) with per-layer visibility, alpha opacity (0..100%), blend modes (Normal, Multiply, Screen, Overlay, Darken, Lighten), and layer reordering.
  - Pinned reference images on canvas with individual scale and opacity controls.
  - Interactive 8-handle transform box supporting real-time stroke scaling and rotation.
  - Spatial canvas annotations: marker pins anchored to canvas coordinates with author, timestamp, and comment threads.

### Layer 3: Presentation & Formatted Documents (`app`)
- **Paginated Document Mode**:
  - A4 aspect ratio page framing (1 : 1.414), multi-page breaks, and repeated running headers/footers with dynamic page numbering.
  - Android Print Framework integration (`DocumentPrintAdapter` & `printWorldsDocument`) generating standards-compliant PDF documents.
- **Math & Diagram Blocks**:
  - KaTeX mathematical equation card with operator parsing, Greek symbols, and LaTeX copy.
  - Mermaid diagram card with node-link graph visualization and source code toggle.
- **Expanded Collaborative Editing**:
  - Collaborative block creation for formatted task lists, bullet lists, ordered lists, and tables in `SharedPageScreen`.

### Layer 4: Intelligence & Integrations (`app/src/.../ai` & `app/src/.../discord`)
- **AI Chat Subsystem**:
  - Multi-model picker (GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro, Worlds AI Local).
  - Conversation threading, context page attachments, token streaming simulation, and 1-tap "Save to Page" export.
- **Automations Subsystem**:
  - Event-driven triggers (`page_created`, `page_updated`, `tag_added`, `daily_schedule`, `webhook`).
  - Actions (`discord_webhook`, `ai_summarize`, `create_task`, `export_markdown`).
  - Background execution via Android `WorkManager` (`AutomationWorker`).
- **Discord Integration Subsystem**:
  - Rich embed builder with embed color swatches (Gold, Sage, Sky, Rose, Blurple).
  - Webhook delivery bridge for publishing pages, notes, and changelogs directly to Discord channels.

### Layer 5: Design System & Adaptive Windowing (`app/src/.../glass` & `app/src/.../adaptive`)
- **`WorldsGlass` Design System**:
  - Translucent surfaces (`WorldsGlassSurface`, `WorldsGlassPanel`, `WorldsGlassToolbar`, `WorldsGlassNavigation`, `WorldsGlassButton`, `WorldsGlassDialog`, `WorldsGlassSheet`).
  - Hardware-accelerated window blur via `Window.setBackgroundBlurRadius()` and `FLAG_BLUR_BEHIND` on Android 12+ (API 31+) and ChromeOS.
  - Smooth specular gradients and high-contrast tint fallback on API 26..30.
- **`WorldsAdaptiveLayout` Engine**:
  - `WindowSizeClass` breakpoints (`Compact`, `Medium`, `Expanded`, `Large`, `ExtraLarge`).
  - Adaptive scaffolds: Bottom navigation on phones, Navigation Rail on tablets/foldables, persistent multi-pane sidebar on Chromebooks and large screens.
  - ChromeOS desktop productivity: freeform window resizing, mouse hover, right-click context menus, trackpad scrolling, and full physical keyboard shortcuts (`Ctrl+S`, `Ctrl+F`, `Ctrl+Z`, `Ctrl+Y`, `Ctrl+N`, `Ctrl+W`).

---

## 3. Build & CI Pipeline

- Standard Gradle wrapper (`./gradlew`) executing `:app:assembleDebug`, `:app:assembleRelease`, `:app:bundleRelease`.
- Multi-architecture ABI split packaging (`arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86`).
- GitHub Actions CI (`.github/workflows/android-platforms.yml`) validating all Kotlin unit tests, Cargo tests, Lint analysis, and emulator instrumentation.
