# Android stylus support

`WorldsStylusEngine` routes pen start, movement, end, cancellation and hover
events. `AndroidStylusInput` reads MotionEvent pointer IDs, stylus and eraser
tool types, button state, historical positions and available pressure, tilt,
orientation and distance axes. Missing device axes are represented as null.
The consumer owns drawing, storage, rendering and touch gesture policy. The
adapter does not claim or suppress finger input.

`StrokeRecorder` can translate routed pen streams into bounded scene-coordinate
strokes using a transform and missing-axis policy supplied by its consumer. It
keeps the accepted part of a stroke at the work limit and discards canceled
strokes. `StrokeGeometry` implements the desktop pressure, taper, smoothing,
straight-line, spacing and seeded dab calculations, including the desktop work
limits. It does not implement the desktop pigment renderer or scene model.
The two test brushes are checked against a fixture generated from the desktop
source; other brush renderers and complete drawing compatibility remain open.

To check the fixture with Node 24 from the Android directory:

```sh
node --no-warnings --loader ./core/stylus/tools/desktop-loader.mjs ./core/stylus/tools/desktop-fixtures.mjs --check
```

The app now includes an early local drawing surface using this input pipeline.
It supports touch and pen strokes, pressure when reported, a hard round pen,
five ink colors, independent pen, highlighter and eraser widths, and local undo and redo. The highlighter uses a continuous single-opacity stroke; imported compatible marker strokes are also rendered.
Two fingers can pan and pinch the frame; buttons offer zoom and Fit, and mouse
wheel zoom is anchored at the pointer. The first
touch stroke is canceled when a second finger begins navigation. A pen takes
priority and cancels an active touch stroke or pre-existing navigation gesture.
While a pen stroke is active, two fingers can pan and zoom; a single finger
does not draw. A supported hovering stylus shows a temporary cursor ring that
is not exported. Canceled-pointer flags on Android
13 and newer roll back a tentative touch gesture.
Completed strokes are saved to a private SQLite
journal. A PNG or a Worlds project with editable scene and operation history
can be written through the Android document picker. Project export supports only
the local stroke format, with at most 500 operations and a 64 MiB package limit.
The renderer rejects unsupported scene features rather than silently
omitting them. The Android document picker can import supported hard-pen, marker and highlighter projects from Android or desktop. Scene-only packages become a new baseline; packages with a compatible history retain authors and operations. Undo on Android applies to Android edits, preserving the original author boundaries. A package preview is verified and treated as a derived thumbnail, not stored as drawing content. Complex desktop projects, synchronization and general desktop drawing editing remain unsupported. Additional brushes, selection resize and rotation, handwriting, annotations,
prediction, low latency rendering and real mixed-input palm rejection remain
unimplemented or unverified. No Samsung SDK
is required. S Pen and USI behavior has not been established on hardware.

Android documentation: [Advanced stylus features](https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/advanced-stylus-features).
See also [stylus palm rejection](https://developer.android.com/develop/adaptive-apps/cookbook/stylus-palm-rejection).


Synthetic Android 15 events exercise pen movement while two fingers change the viewport, pen release while navigation continues, canceled-touch viewport rollback, and stylus hover rendering and exit. The tests also check the final pen sample maps to the current scene coordinates. They do not establish real hardware hover, palm rejection or latency. When navigation is canceled, samples recorded during that gesture are recalculated against the restored viewport while earlier samples stay unchanged. If the pen lifts first, the stroke waits until the navigation finishes so a later cancellation can still be handled. Synthetic tests cover these cases and the stroke work limit; physical-device behavior and latency remain unverified.

Drawing settings offer an opt-in primary stylus-button eraser. Hold the button before contact; the selected behavior remains fixed until the stroke ends. The secondary button and finger input do not trigger it, and the hardware eraser remains supported. Synthetic Android 15 input tests cover these cases and the disabled setting. The shortcut has not been tested on a physical pen and depends on the device reporting the primary button.

With keyboard focus in the drawing screen, B selects the pen, H selects the highlighter, E selects the eraser, Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes, and Ctrl+0 fits the canvas. These match the existing desktop defaults for the implemented tools. Drawing settings list these commands, and the Android keyboard shortcut helper receives the same commands while the editor owns focus. Input is ignored while settings or export menus are open, while loading or saving, and during a stroke or navigation. Android 15 emulator tests send hardware-style key events and verify tool selection, undo, redo, fitting and dialog isolation. A physical Chromebook keyboard and multi-window focus have not been verified.

### Stable drawing replay
The drawing canvas records bounded vector commands for the saved scene and
replays them while new ink is drawn. Active strokes and erasers are composited
in the same layer; a selected group being moved is drawn from current geometry.
The recording is discarded when the document changes or the view detaches.
Scenes above the recording work limit use the original direct renderer. Android
11 and 15 emulator tests compare cached and direct pixels for hard pen,
highlighter, pencil and eraser across saved and active stroke splits. An Android
15 window capture also checks the erased gap and retained ink after undo and
redo. Hardware latency, memory under large real drawings and physical stylus
response remain unverified.

### Natural pencil
The local canvas provides the Worlds natural-pencil brush with pressure-sensitive size and pigment. At pen down, available tilt determines a fixed tip angle and roundness for the stroke; those settings and the original samples are stored. A device with no tilt data uses a round tip. The Android renderer uses seeded pigment dabs and supports PNG and Worlds package export. Android 15 emulator and JVM tests cover synthetic fallback, pressure data, undo, redo and package round trips. Pixel equivalence with the desktop renderer, continuous tilt changes, physical hardware and latency have not been verified.
