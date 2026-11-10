# ChromeOS & Large Screen Desktop Guide

## 1. Overview & Architecture

Worlds is designed for first-class desktop productivity on ChromeOS (Chromebooks, Chromeboxes, and ChromeOS tablets) running in the ARC-VM (Android Runtime on Chrome) container.

Key desktop capabilities enabled:
- **Freeform Resizable Windows**: Smooth real-time resizing from phone-like floating windows up to 4K ultra-wide displays.
- **Adaptive Multi-Pane Navigation**: Seamless transitions across `Compact`, `Medium`, `Expanded`, and `Large` layouts via `WorldsAdaptiveLayout`.
- **Full Physical Keyboard & Mouse Productivity**: Comprehensive keyboard shortcuts, trackpad gestures, and right-click context menus.
- **Universal Stylus Initiative (USI 2.0)**: Hardware-accelerated drawing, pressure sensitivity, hover tracking, and palm rejection.

---

## 2. Desktop Keyboard Shortcuts

Worlds registers system shortcuts through Android's `KeyboardShortcutGroup` API (accessible via `Search + /` on ChromeOS) and handles global keyboard events:

### Document & Page Shortcuts
| Key Combo | Action | Context |
| :--- | :--- | :--- |
| `Ctrl + S` | Save current page, block, or draft | Editors, Shared Page |
| `Ctrl + F` | Open Find & Search bar | Document, Page detail |
| `Ctrl + H` | Open Find & Replace dialog | Document, Page detail |
| `Ctrl + N` | Create new Page / Document | Library view |
| `Ctrl + W` | Close current document / back | Active detail pane |
| `Ctrl + P` | Open Print / PDF export dialog | Document detail |
| `Enter` / `Shift + Enter` | Find next / Find previous match | Search bar |
| `Escape` | Dismiss dialog or close editor | Global |

### Drawing Canvas Shortcuts
| Key Combo | Action | Description |
| :--- | :--- | :--- |
| `B` | Hard Pen Tool | Switch active tool to Pen |
| `P` | Natural Pencil Tool | Switch active tool to Pencil |
| `H` | Highlighter Tool | Switch active tool to Highlighter |
| `E` | Eraser Tool | Switch active tool to Eraser |
| `M` | Selection Tool | Switch to Marquee Stroke Selection |
| `Ctrl + Z` | Undo | Undo last stroke, layer, or transform |
| `Ctrl + Shift + Z` / `Ctrl + Y` | Redo | Redo undone canvas action |
| `Ctrl + 0` | Fit to Canvas | Reset viewport zoom and pan |
| `Ctrl + D` | Clear Selection | Deselect currently highlighted strokes |
| `Delete` / `Backspace` | Delete Strokes | Remove selected stroke group |

---

## 3. Mouse & Trackpad Integration

- **Trackpad Pinch-to-Zoom**: Smooth zooming centered on the pointer cursor.
- **Mouse Wheel Pan & Zoom**: Standard wheel scrolls canvas vertically; `Ctrl + Wheel` zooms into pointer coordinates.
- **Right-Click Context Menus**: Secondary click triggers native `DropdownMenu` for block actions, table cell operations, and layer settings.
- **Hover States**: Visual hover indicators on buttons, table cells, and stylus drawing cursor without triggering touches.

---

## 4. USI 2.0 Stylus & Chromebook Pens

Worlds leverages `WorldsStylusEngine` to communicate directly with ChromeOS stylus hardware:
- **Pressure Sensitivity**: Dynamically modulates stroke thickness across 4096 pressure levels.
- **Tilt Detection**: Computes tip altitude and azimuth for calligraphic shading with the Pencil tool.
- **Hover Cursor Tracking**: Displays tool cursor ring hovering up to 15mm above the screen.
- **Tail Eraser**: Inverting the pen or pressing the barrel button immediately activates stroke erasure.
- **Palm Rejection**: Strict hardware rejection ignores resting palm contacts while pen is near the digitizer.

---

## 5. Freeform Windowing & Multi-Monitor Support

- Minimum window dimensions: `360dp x 480dp`.
- Dynamic layout reflow: switching between single-pane, two-pane, and three-pane layouts on the fly without Activity restart (`android:configChanges="screenSize|smallestScreenSize|screenLayout|orientation"`).
- Multi-display migration: moving Worlds between the Chromebook internal screen and an external high-resolution monitor preserves cursor position, open document revisions, and drawing viewport state.
