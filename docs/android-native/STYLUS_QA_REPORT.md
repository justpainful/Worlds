# Stylus QA report

PNG export was checked on Android 15 using the system file picker and local
Downloads provider. An instrumentation test decodes the exported PNG and
checks the frame size, ink, erased pixels and white background. It also checks
that an unsupported brush is rejected. Other Android document providers and
export formats remain untested or unimplemented.

The Android 15 tests also change pen color and width through the UI, save a
stroke, and reopen it. A separate test checks two colors and widths after local
undo, redo, reload and PNG generation. An example colored drawing was accepted
by the desktop scene validator and operation replay. This does not establish
full drawing-format interoperability or real pen behavior.

The Android 15 emulator saved a version 2 Worlds drawing package through the
system Downloads picker. The actual desktop `readDrawingPackage` function
accepted that file and checked its scene and three history operations. A
separate Android test rejects altered history and excessive operation counts.
The validator loader explicitly refuses optional library, path, preview and
pixel-guard features; desktop UI import and complex packages were not tested.

Viewport navigation was tested with synthetic Android touch events: two fingers
pinch and pan without committing the initial touch, a subsequent stroke lands
at the expected scene coordinate, and Fit restores the default viewport. Other
tests cover canceled second-pointer rollback, stylus priority over a touch, and
mouse-wheel zoom anchored at the pointer. Those tests did not establish physical palm rejection or real Chromebook input behavior.

On 2026-11-07, the pure Kotlin event router passed a local executable check for
stream ordering, duplicate starts, cancellation, eraser data and hover. Three
Android instrumentation tests passed on an Android 15 API 35 x86_64 emulator.
They used synthetic MotionEvents to check historical samples, cancellation,
eraser tool type and mixed finger and pen pointer routing. The API 33 flag test
is skipped on earlier versions. The adapter also compiled against API 37.

Not tested: a physical phone, tablet, foldable, Samsung S Pen, USI, Chromebook,
pressure, tilt, hover hardware, eraser hardware, palm rejection, drawing latency,
handwriting, physical simultaneous touch and pen, keyboard with pen, or
multi-window. Synthetic pointer tests do not establish hardware palm rejection.
No latency, screenshots, device-specific compatibility or visual results are
claimed. These initial tests preceded integration with an editable drawing surface.

An additional JVM suite verifies recording, independent eraser and pen streams,
cancellation, work limits, width and taper. It also compares 24 generated dabs
from the actual desktop TypeScript algorithm for two brush configurations.
The Android emulator receives synthetic MotionEvents through the native adapter
and recorder. Synthetic events have no hardware axis range; the test explicitly
supplies a pressure fallback. These checks do not verify a physical stylus,
complete brush rendering or low-latency input.

The local drawing surface was exercised on an Android 15 emulator by touch:
the UI test creates a drawing, records ink, undoes and redoes it, adds an eraser
stroke and reopens the drawing. Storage tests cover stale revisions and failed
input. A document generated in the emulator passed the original desktop
`validateScene` function, and its operation journal replayed to the same scene
with the desktop `replay` function. This proves only the tested hard-pen and
eraser example, not desktop file import, export or synchronization.


### Drawing package reading groundwork

The Android drawing store can validate and insert the Android-supported version 2 stroke journal from a `.worldsdraw` stream under a new drawing ID. It checks the package scene against its complete history, rejects unknown package fields, assets, saved versions, unsupported history and invalid input, and limits both compressed and expanded input to 64 MiB. An existing drawing ID cannot be replaced. Instrumentation exercises redo and new edits after insertion, rejection of damaged or unsupported packages, and preservation of the original. The Android picker now imports this subset into a new local drawing. The content resource and a staging copy are committed in one database transaction, and the editor removes the staging copy only after its own journal is committed. Instrumentation covers a failed journal insertion and reopening, and an emulator run selected a project in the system picker and opened its ink. Arbitrary desktop drawings remain unsupported. The size ceiling is not a guarantee that every device can import a file near that limit.


### Desktop hard-pen project import

The original desktop model and package writer generated version 1 scene-only
and version 2 multi-author fixtures. Android imported both, retained the version 2
authors and the desktop replay order after cross-author undo and redo, added an
Android stroke, and undid it. The original desktop package reader accepted both
Android re-exports. The desktop reader test uses the existing narrow loader,
which stubs unrelated assets, path, preview and library features. A preview is
validated as a PNG with matching size and SHA-256, then omitted as a derived
thumbnail from the new project. The real desktop UI and complex projects were not
tested. On Android, imported authors remain distinct; the local undo controls
affect only Android's own operations. These checks do not cover synchronization.


### Continuous highlighter and marker

The highlighter uses the desktop uniform-stroke geometry and composites each
stroke once. Instrumentation checks alpha on overlapping segments, cap shape,
pressure width, undo, redo, package round trips and the selection control. The
desktop package writer generated a fixture containing highlighter and marker
strokes; Android imported, edited and re-exported it, and the desktop package
reader accepted the result using the narrow loader. No pixel-by-pixel comparison
with the desktop rasterizer or physical pen was performed. Other brush kinds,
full layer support and synchronization remain incomplete.


## Mixed input and hover on emulator

Eight Android 15 instrumentation tests passed with synthetic MotionEvents. They cover simultaneous pen and two-finger zoom, keeping navigation active after the pen lifts, canceled touch navigation while a pen stroke continues, and hover cursor rendering and removal. The test checks the final pen point against the resulting viewport transform. Synthetic events do not establish physical palm rejection, real stylus hover or latency. Cancellation tests now check the actual pre-gesture, during-gesture and final coordinates both when the pen is still down and when it has already lifted. Separate recorder tests cover the work limit during reprojection. Two drawing UI tests also passed for saving, reopening, undo and the highlighter. These checks do not prove physical input quality or latency.

### Natural pencil validation
JVM tests cover tip geometry from synthetic tilt and fallback with unavailable values. Android 15 emulator tests cover a synthetic pen with unavailable axes, the eraser, a canvas stroke, storage, deterministic PNG replay, undo, redo and a Worlds package round trip. These tests do not simulate a real pen's motion range and do not establish real pressure, tilt quality or drawing latency.
