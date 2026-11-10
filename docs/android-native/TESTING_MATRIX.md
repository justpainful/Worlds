# Android & ChromeOS Native Testing Matrix

## 1. Overview

This document specifies the verification coverage, automated test suites, hardware test matrix, and quality assurance criteria for Worlds Android and ChromeOS.

---

## 2. Automated Test Suites

### A. Kotlin & Compose Unit Tests (`*UnitTest`)
Run across all modules via:
```bash
./gradlew :app:testDebugUnitTest :core:content:testDebugUnitTest :core:stylus:testDebugUnitTest :core:sync:testDebugUnitTest
```

| Module | Test Class | Coverage Area | Status |
| :--- | :--- | :--- | :--- |
| `:app` | `DocumentTypographyTest` | A4 document typography, font scale, leading | PASS |
| `:app` | `DocumentPrintAdapterTest` | A4 pagination, PDF document generation, headers/footers | PASS |
| `:app` | `AiClientTest` | Message threading, token streaming, context attachments | PASS |
| `:app` | `AutomationWorkerTest` | Scheduled trigger evaluation, action dispatch | PASS |
| `:core:content` | `AutomationsTest` | SQLite automation rules CRUD, execution logs | PASS |
| `:core:content` | `ContentStoreTest` | Atomic revisions, personal page tree moves, conflict rejection | PASS |
| `:core:stylus` | `StylusEngineTest` | Event routing, Start/Move/End/Hover/Cancel states | PASS |
| `:core:stylus` | `StrokeGeometryTest` | Bezier smoothing, pressure width calculation | PASS |
| `:core:stylus` | `StrokeRecorderTest` | Journal replay, undo/redo stroke stack | PASS |
| `:core:sync` | `SyncSessionTest` | Yrs collaborative transactions, outbox durable queue | PASS |
| `:core:sync` | `OfflineEditorTest` | Offline insertion, block duplication, mark preservation | PASS |

### B. Native Rust Engine Tests (`cargo test`)
Run via:
```bash
cargo test --locked --manifest-path core/sync/native/Cargo.toml
```
Coverage includes:
- `editor_append_paragraph` — block insertion, anchor matching, duplicate ID rejection.
- `editor_replace_text` — UTF-16 character offset translations and concurrent edits.
- `editor_duplicate_text_block` — identity-preserving block cloning.
- `block_identity` — deterministic XML element lookup.

### C. Android Lint Static Analysis
Run via:
```bash
./gradlew :app:lintDebug :core:sync:lintDebug :core:stylus:lintDebug
```
- Enforces Material 3 accessibility standards, 48dp minimum touch targets, zero hardcoded colors outside theme tokens, and RTL layout compatibility.

---

## 3. Hardware & Device Form Factor Matrix

| Device Profile | Form Factor | Resolution & DPI | OS Version | Input Methods | Target Validated |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Compact Phone | Phone (Portrait) | 1080 x 2400 (420 dpi) | Android 11, 14, 15 | Touch, Keyboard | PASS |
| Narrow Phone | Small Phone | 320 x 640 (160 dpi) | Android 10, 15 | Touch, Keyboard | PASS |
| Foldable (Outer) | Cover Screen | 904 x 2316 (401 dpi) | Android 14, 15 | Touch, S Pen Fold | PASS |
| Foldable (Inner) | Unfolded Tablet | 1812 x 2176 (374 dpi) | Android 14, 15 | Multi-touch, S Pen | PASS |
| Foldable (Half) | Tabletop / Book | Flex Mode Posture | Android 14, 15 | Touch, Stylus | PASS |
| Tablet (11-12") | Mid Tablet | 1600 x 2560 (280 dpi) | Android 13, 14, 15 | S Pen, Bluetooth Kbd | PASS |
| Tablet (14.6") | Large Tablet | 1848 x 2960 (240 dpi) | Android 14, 15 | S Pen, Keyboard Cover | PASS |
| Chromebook | Clamshell / 2-in-1 | 1920 x 1080 (140 dpi) | ChromeOS ARC-VM | USI 2.0, Trackpad, Mouse | PASS |

---

## 4. Stylus & Pen Input Matrix

| Capability | Samsung S Pen | USI 2.0 Chromebook | Generic Stylus | Verification Result |
| :--- | :--- | :--- | :--- | :--- |
| Pressure Sensitivity (4096 levels) | Supported | Supported | Simulated (1.0f) | PASS |
| Tilt Detection (altitude & azimuth) | Supported | Supported | Not reported | PASS |
| Hover Tracking & Cursor | Supported | Supported | Unsupported | PASS |
| Barrel Buttons (Primary & Eraser) | Supported | Supported | Unsupported | PASS |
| Palm Rejection (Strict pen priority) | Hardware | Hardware | Software bounding box | PASS |
| Mixed Touch Navigation (2-finger zoom) | Supported | Supported | Supported | PASS |
| Drawing Latency (< 15ms target) | Low-latency | Standard | Variable | PASS |

---

## 5. Visual, RTL & Accessibility Matrix

| Category | Evaluation Points | Standard / Requirement | Result |
| :--- | :--- | :--- | :--- |
| **RTL Support** | Arabic localization, mirroring, typography | Full LTR/RTL mirror, Arabic text alignment | PASS |
| **Touch Targets** | Interactive icons, buttons, list menus | Minimum 48 x 48 dp per Material 3 guidelines | PASS |
| **Contrast Ratios** | Text against surfaces in Light & Dark modes | WCAG 2.1 AA (minimum 4.5:1 for body text) | PASS |
| **Large Text Scale**| Android accessibility font scaling up to 2.0x | Zero text truncation, scrollable containers | PASS |
| **Dynamic Color** | Material You wallpaper-extracted dynamic palette | Seamlessly maps to Worlds surface & accent tokens | PASS |
