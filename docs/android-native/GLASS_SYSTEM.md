# WorldsGlass Design System Specification

## 1. Overview and Design Philosophy

WorldsGlass is the native design system for Worlds on Android and ChromeOS. It provides an authentic, high-fidelity glassmorphic aesthetic inspired by translucent optical materials, specular sheens, and frosted diffusion.

Rather than relying on flat or opaque cards, WorldsGlass creates visual depth through:
- Layered translucent backgrounds with variable alpha channels.
- Directional specular highlights simulating ambient light reflection.
- Crisp, 1dp semi-transparent boundary borders.
- True hardware-accelerated window blur on Android 12+ (API 31+) and ChromeOS.
- Dynamic theme adaptation (light mode frosted quartz vs. dark mode obsidian glass).

---

## 2. Component Inventory (`worlds.android.glass`)

All components are located in `worlds.android.glass` and built entirely with native Jetpack Compose:

| Component | Role & Usage | Visual Traits |
| :--- | :--- | :--- |
| `WorldsGlassSurface` | Foundational surface container | Layered translucent fill, specular gradient sheen, 1dp border |
| `WorldsGlassPanel` | Adaptive cards, content panels, multi-pane views | Configurable title header, trailing action slots, 18dp rounded corners |
| `WorldsGlassToolbar` | Floating stylus palette, document action bar | Capsule shape (24dp), docked or floating layout, 48dp minimum touch target |
| `WorldsGlassNavigation` | Navigation rail (tablets), bottom bar (phones) | Seamless edge docking, glass background, active item elevation |
| `WorldsGlassButton` | Action buttons, dialog dismiss/confirm | Tactile feedback, ripple, contrast-compliant label text |
| `WorldsGlassDialog` | Modal confirmation, settings dialogs | Frosted window scrim, elevated glass card container |
| `WorldsGlassSheet` | Bottom sheets, layer manager sheet | Rounded top corners (24dp), draggable drag handle, smooth spring animations |
| `WorldsGlassContainer` | Generic glass wrapper | Drops into any Compose hierarchy |
| `WorldsGlassOverlay` | Full-screen modal overlay | Semi-transparent dark scrim preserving background legibility |

---

## 3. Hardware Window Blur Architecture (`WorldsWindowBlur`)

Android 12 (API 31) introduced platform-level window blur APIs through `WindowManager`. WorldsGlass utilizes these APIs natively:

### API 31+ Implementation
```kotlin
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    val windowManager = activity.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    if (windowManager?.isCrossWindowBlurEnabled == true) {
        window.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
        window.attributes.blurBehindRadius = 40 // px
        window.setBackgroundBlurRadius(40)
    }
}
```

### Fallback for Android 8.0 - 11 (API 26..30)
On devices prior to Android 12 or where cross-window blur is disabled for battery saving:
- Blur behind radius is safely bypassed without crashes.
- Compose surfaces fall back to a high-contrast tinted translucent surface (`Color(0xD8F8F9FB)` light / `Color(0xCC1A1A20)` dark).
- Specular highlights and border strokes maintain the visual glass hierarchy with zero runtime overhead.

### ChromeOS Glass Integration
On Chromebooks running the ARC (Android Runtime on Chrome) container:
- Worlds utilizes system window compositing for freeform and tiled desktop windows.
- ChromeOS hardware acceleration renders glass borders and translucent panels without frame drops.

---

## 4. Appearance Controls (`AppearanceSettings.kt`)

Users can customize glass behavior under **Appearance Settings**:
1. **Glass Effects Quality**:
   - `Specular` — Full gradient sheen, elevated shadows, maximum optical depth.
   - `Standard` — Subtle sheen, balanced contrast and performance.
   - `Disabled` — Solid surface fills for maximum power saving or high-contrast preference.
2. **Reduced Motion**:
   - Disables decorative spring animations in favor of instant state transitions.
