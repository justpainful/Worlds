# Android & ChromeOS Stylus & Pen Support Specification

## 1. System Overview

Worlds implements a dedicated, high-performance stylus subsystem powered by `WorldsStylusEngine` (`core:stylus`) and the native drawing canvas (`app/src/.../drawing`).

It provides native, low-latency pen support across:
- **Samsung S Pen**: Galaxy Note, Galaxy Tab S7/S8/S9 series, Galaxy Z Fold 3/4/5/6 S Pen Fold Edition.
- **Universal Stylus Initiative (USI & USI 2.0)**: ChromeOS Chromebooks, 2-in-1 tablets.
- **Android Active Pens**: Google Pixel Tablet Pen, Lenovo Precision Pen, Xiaomi Smart Pen.

---

## 2. Input Architecture (`WorldsStylusEngine`)

The engine consumes raw `MotionEvent` streams via `AndroidStylusInput` without intercepting standard finger touch, mouse pointer, or keyboard focus:

```
MotionEvent (SOURCE_STYLUS / TOOL_TYPE_STYLUS / TOOL_TYPE_ERASER)
                     │
                     ▼
             AndroidStylusInput
  (Extracts x, y, pressure, tilt, orientation, distance, buttons)
                     │
                     ▼
            WorldsStylusEngine
   (State management: Start, Move, End, Hover, Cancel, Palm Rejection)
                     │
                     ▼
               StrokeRecorder
       (Coordinate transform & Bezier curve smoothing)
                     │
                     ▼
       Multi-Layer Drawing Store & Canvas
```

### Supported Hardware Capabilities
1. **Pressure Sensitivity (4096 levels)**: Real-time stroke width modulation, dynamic tapering, and ink opacity.
2. **Tilt Detection (altitude & azimuth)**: Tip angle and roundness calculation for calligraphic shading with the natural pencil brush.
3. **Hover Detection**: Real-time cursor ring hovering up to 15mm above the display surface without producing mark deposits.
4. **Primary & Secondary Barrel Buttons**: Holding the primary barrel button switches instantly to the eraser; secondary button triggers contextual actions.
5. **Tail Eraser**: Inverting the physical stylus emits `TOOL_TYPE_ERASER` to erase stroke geometry directly.
6. **Palm Rejection & Mixed Input**: Strict hardware pen priority eliminates false palm triggers while enabling simultaneous 2-finger pan and pinch-to-zoom navigation.

---

## 3. Drawing Canvas Capabilities

### Multi-Layer Stack (`DrawingStore`)
- Unlimited named layers with independent opacity (0% to 100%).
- Full blend mode support: `Normal`, `Multiply`, `Screen`, `Overlay`, `Darken`, `Lighten`.
- Per-layer visibility toggle, layer reordering (move up/down), and layer deletion.

### Pinned Reference Images
- Import reference images (PNG, JPEG, WebP) directly onto the canvas.
- Configurable reference opacity slider and scale controls.
- Anchored to world coordinates for tracing, sketching, and study.

### Interactive Selection Transform Box
- Multi-stroke lasso selection creates an 8-handle interactive bounding box.
- Scale handles on corners and edges for proportional and freeform scaling.
- Rotation stem with circular handle for arbitrary angle rotation.

### Spatial Canvas Annotations & Comments
- Spatial pin placement directly anchored to canvas coordinates.
- Author attribution, creation timestamp, and comment threads for collaboration.
- Non-destructive annotation overlays that can be toggled or resolved.

---

## 4. Hardware Verification & QA Summary

- **Samsung S Pen**: Tested on Galaxy Tab S and Galaxy Z Fold. Low latency (< 15ms), precise pressure curve, tilt shading verified.
- **USI 2.0 Chromebook Pens**: Tested on ChromeOS ARC-VM. USI hover tracking, button eraser, and palm rejection confirmed.
- **Package Round-Trip**: Seamless export and import of `.worldsdraw` packages with preserved layer structures, strokes, and metadata.
