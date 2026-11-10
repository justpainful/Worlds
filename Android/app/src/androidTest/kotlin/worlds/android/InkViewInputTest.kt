package worlds.android

import android.view.InputDevice
import android.view.MotionEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class InkViewInputTest {
    private fun properties(id: Int, tool: Int) = MotionEvent.PointerProperties().apply { this.id = id; toolType = tool }
    private fun coords(x: Float, y: Float) = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 0.7f }
    private fun event(action: Int, time: Long, props: Array<MotionEvent.PointerProperties>, points: Array<MotionEvent.PointerCoords>, flags: Int = 0, buttons: Int = 0): MotionEvent =
        MotionEvent.obtain(1, time, action, props.size, props, points, 0, buttons, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, flags)
    private fun send(view: InkView, event: MotionEvent) { try { view.onTouchEvent(event) } finally { event.recycle() } }

    @Test fun pencilUsesNeutralTipWhenDeviceAxesAreUnavailableAndEraserStillWorks() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            fun draw(tool: Int): PendingStroke {
                val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext)
                view.layout(0, 0, 1000, 1000); view.pencil = true; view.pencilWidth = 12.0
                val result = mutableListOf<PendingStroke>(); view.complete = result::add
                val pen = properties(4, tool)
                send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(pen), arrayOf(coords(300f, 500f))))
                send(view, event(MotionEvent.ACTION_UP, 11, arrayOf(pen), arrayOf(coords(350f, 500f))))
                return result.single()
            }
            val pencil = draw(MotionEvent.TOOL_TYPE_STYLUS)
            assertEquals("natural-pencil", pencil.brush.kind); assertEquals(12.0, pencil.brush.size, 0.0); assertEquals(1.0, pencil.brush.roundness, 0.0)
            val eraser = draw(MotionEvent.TOOL_TYPE_ERASER)
            assertTrue(eraser.erase); assertEquals("hard", eraser.brush.kind)
        }
    }

    @Test fun multipleSelectionMovesGroupAndTapRemovesOne() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "selection-group-${java.util.UUID.randomUUID()}.db"; val store = DrawingStore(context, name)
        try {
            store.loadOrCreate("group")
            val point = worlds.stylus.StrokeSample(100.0, 100.0, 1.0, 0.0, 0.0, 0.0)
            store.addStroke("group", 0, listOf(point), worlds.stylus.StrokeBrush(size = 10.0), false)
            val doc = store.addStroke("group", 1, listOf(point.copy(x = 300.0)), worlds.stylus.StrokeBrush(size = 10.0), false)
            val order = doc.getJSONObject("scene").getJSONArray("nodeOrder"); val a = order.getString(0); val b = order.getString(1)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                val view = InkView(context); view.layout(0, 0, 1280, 720); view.document = doc.toString(); view.selectionMode = true; view.multiSelect = true
                val moves = mutableListOf<Triple<Set<String>, Double, Double>>(); view.moveStrokes = { ids, dx, dy -> moves.add(Triple(ids, dx, dy)) }
                val pen = properties(4, MotionEvent.TOOL_TYPE_STYLUS)
                fun tap(x: Float, t: Long) { send(view, event(MotionEvent.ACTION_DOWN, t, arrayOf(pen), arrayOf(coords(x, 100f)))); send(view, event(MotionEvent.ACTION_UP, t + 1, arrayOf(pen), arrayOf(coords(x, 100f)))) }
                tap(100f, 10); tap(300f, 20); assertEquals(setOf(a, b), view.selectedGroup)
                send(view, event(MotionEvent.ACTION_DOWN, 30, arrayOf(pen), arrayOf(coords(100f, 100f))))
                send(view, event(MotionEvent.ACTION_MOVE, 31, arrayOf(pen), arrayOf(coords(140f, 130f))))
                send(view, event(MotionEvent.ACTION_UP, 32, arrayOf(pen), arrayOf(coords(140f, 130f))))
                assertEquals(Triple(setOf(a, b), 40.0, 30.0), moves.single())
                tap(300f, 40); assertEquals(setOf(a), view.selectedGroup)
                send(view, event(MotionEvent.ACTION_DOWN, 50, arrayOf(pen), arrayOf(coords(100f, 100f))))
                send(view, event(MotionEvent.ACTION_CANCEL, 51, arrayOf(pen), arrayOf(coords(100f, 100f))))
                assertEquals(setOf(a), view.selectedGroup); assertEquals(1, moves.size)
            }
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun selectionDragMovesTopmostInkAndCancelDoesNotCommit() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "selection-${java.util.UUID.randomUUID()}.db"
        val store = DrawingStore(context, name)
        try {
            store.loadOrCreate("select")
            val point = worlds.stylus.StrokeSample(100.0, 100.0, 1.0, 0.0, 0.0, 0.0)
            store.addStroke("select", 0, listOf(point), worlds.stylus.StrokeBrush(size = 10.0), false)
            val doc = store.addStroke("select", 1, listOf(point.copy(x = 110.0)), worlds.stylus.StrokeBrush(size = 10.0), false)
            val id = doc.getJSONObject("scene").getJSONArray("nodeOrder").getString(1)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                val view = InkView(context); view.layout(0, 0, 1280, 720); view.document = doc.toString(); view.selectionMode = true
                val moves = mutableListOf<Triple<String, Double, Double>>(); view.moveStroke = { key, dx, dy -> moves.add(Triple(key, dx, dy)) }
                val pen = properties(4, MotionEvent.TOOL_TYPE_STYLUS)
                send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(pen), arrayOf(coords(110f, 100f))))
                send(view, event(MotionEvent.ACTION_MOVE, 11, arrayOf(pen), arrayOf(coords(150f, 130f))))
                send(view, event(MotionEvent.ACTION_UP, 12, arrayOf(pen), arrayOf(coords(150f, 130f))))
                assertEquals(Triple(id, 40.0, 30.0), moves.single())
                send(view, event(MotionEvent.ACTION_DOWN, 20, arrayOf(pen), arrayOf(coords(110f, 100f))))
                send(view, event(MotionEvent.ACTION_MOVE, 21, arrayOf(pen), arrayOf(coords(160f, 150f))))
                send(view, event(MotionEvent.ACTION_CANCEL, 22, arrayOf(pen), arrayOf(coords(160f, 150f))))
                assertEquals(1, moves.size)
                send(view, event(MotionEvent.ACTION_DOWN, 30, arrayOf(pen), arrayOf(coords(900f, 500f))))
                send(view, event(MotionEvent.ACTION_UP, 31, arrayOf(pen), arrayOf(coords(930f, 500f))))
                assertEquals(1, moves.size)
            }
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun selectionPinchCancelsFingerDragAndCanBeRolledBack() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "selection-nav-${java.util.UUID.randomUUID()}.db"; val store = DrawingStore(context, name)
        try {
            store.loadOrCreate("nav")
            val point = worlds.stylus.StrokeSample(640.0, 360.0, 1.0, 0.0, 0.0, 0.0)
            val doc = store.addStroke("nav", 0, listOf(point), worlds.stylus.StrokeBrush(size = 30.0), false)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                val view = InkView(context); view.layout(0, 0, 1280, 720); view.document = doc.toString(); view.selectionMode = true
                val moves = mutableListOf<Triple<String, Double, Double>>(); view.moveStroke = { id, dx, dy -> moves.add(Triple(id, dx, dy)) }
                var gesture = false; view.gestureChanged = { gesture = it }
                val a = properties(1, MotionEvent.TOOL_TYPE_FINGER); val b = properties(2, MotionEvent.TOOL_TYPE_FINGER)
                send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(a), arrayOf(coords(640f, 360f))))
                send(view, event(MotionEvent.ACTION_MOVE, 11, arrayOf(a), arrayOf(coords(650f, 360f))))
                send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 12, arrayOf(a,b), arrayOf(coords(650f, 360f), coords(850f, 360f))))
                send(view, event(MotionEvent.ACTION_MOVE, 13, arrayOf(a,b), arrayOf(coords(550f, 360f), coords(950f, 360f))))
                assertTrue(view.viewport.zoom > 1.5); assertTrue(gesture)
                send(view, event(MotionEvent.ACTION_CANCEL, 14, arrayOf(a,b), arrayOf(coords(550f, 360f), coords(950f, 360f))))
                assertEquals(DrawingViewport(), view.viewport); assertTrue(moves.isEmpty()); assertFalse(gesture)
            }
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun selectionPenTakesOverFingerDrag() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "selection-priority-${java.util.UUID.randomUUID()}.db"; val store = DrawingStore(context, name)
        try {
            store.loadOrCreate("priority")
            val point = worlds.stylus.StrokeSample(100.0, 100.0, 1.0, 0.0, 0.0, 0.0)
            val doc = store.addStroke("priority", 0, listOf(point), worlds.stylus.StrokeBrush(size = 20.0), false)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                val view = InkView(context); view.layout(0, 0, 1280, 720); view.document = doc.toString(); view.selectionMode = true
                val moves = mutableListOf<Triple<String, Double, Double>>(); view.moveStroke = { key, dx, dy -> moves.add(Triple(key, dx, dy)) }
                val finger = properties(1, MotionEvent.TOOL_TYPE_FINGER); val pen = properties(2, MotionEvent.TOOL_TYPE_STYLUS)
                send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(finger), arrayOf(coords(100f, 100f))))
                send(view, event(MotionEvent.ACTION_MOVE, 11, arrayOf(finger), arrayOf(coords(120f, 100f))))
                send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 12, arrayOf(finger,pen), arrayOf(coords(120f, 100f), coords(100f, 100f))))
                send(view, event(MotionEvent.ACTION_MOVE, 13, arrayOf(finger,pen), arrayOf(coords(150f, 100f), coords(130f, 130f))))
                send(view, event(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 14, arrayOf(finger,pen), arrayOf(coords(150f, 100f), coords(130f, 130f))))
                send(view, event(MotionEvent.ACTION_UP, 15, arrayOf(finger), arrayOf(coords(150f, 100f))))
                assertEquals(1, moves.size); assertEquals(30.0, moves.single().second, 0.0); assertEquals(30.0, moves.single().third, 0.0)
            }
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun selectionPenDragContinuesAcrossTwoFingerNavigation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "selection-mixed-${java.util.UUID.randomUUID()}.db"; val store = DrawingStore(context, name)
        try {
            store.loadOrCreate("mixed")
            val point = worlds.stylus.StrokeSample(640.0, 360.0, 1.0, 0.0, 0.0, 0.0)
            val doc = store.addStroke("mixed", 0, listOf(point), worlds.stylus.StrokeBrush(size = 30.0), false)
            val id = doc.getJSONObject("scene").getJSONArray("nodeOrder").getString(0)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                val view = InkView(context); view.layout(0, 0, 1280, 720); view.document = doc.toString(); view.selectionMode = true
                val moves = mutableListOf<Triple<String, Double, Double>>(); view.moveStroke = { key, dx, dy -> moves.add(Triple(key, dx, dy)) }
                val pen = properties(3, MotionEvent.TOOL_TYPE_STYLUS); val a = properties(1, MotionEvent.TOOL_TYPE_FINGER); val b = properties(2, MotionEvent.TOOL_TYPE_FINGER)
                send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(pen), arrayOf(coords(640f, 360f))))
                send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 11, arrayOf(pen,a), arrayOf(coords(640f, 360f), coords(400f, 360f))))
                send(view, event(MotionEvent.ACTION_POINTER_DOWN or (2 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 12, arrayOf(pen,a,b), arrayOf(coords(640f, 360f), coords(400f, 360f), coords(800f, 360f))))
                send(view, event(MotionEvent.ACTION_MOVE, 13, arrayOf(pen,a,b), arrayOf(coords(720f, 400f), coords(300f, 360f), coords(900f, 360f))))
                assertTrue(view.viewport.zoom > 1.0)
                send(view, event(MotionEvent.ACTION_POINTER_UP, 14, arrayOf(pen,a,b), arrayOf(coords(720f, 400f), coords(300f, 360f), coords(900f, 360f))))
                assertEquals(id, moves.single().first); assertTrue(moves.single().second > 0); assertTrue(moves.single().third > 0)
                send(view, event(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 15, arrayOf(a,b), arrayOf(coords(300f, 360f), coords(900f, 360f))))
                send(view, event(MotionEvent.ACTION_UP, 16, arrayOf(a), arrayOf(coords(300f, 360f))))
                assertEquals(1, moves.size)
            }
        } finally { store.close(); context.deleteDatabase(name) }
    }

    @Test fun stylusShortcutIsOptInAndFixedForTheWholeStroke() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            fun stroke(tool: Int, enabled: Boolean, firstButtons: Int, laterButtons: Int): PendingStroke {
                val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext)
                view.layout(0, 0, 1000, 1000); view.barrelEraser = enabled; view.eraserWidth = 40.0
                val result = mutableListOf<PendingStroke>(); view.complete = result::add
                val pointer = properties(4, tool)
                send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(pointer), arrayOf(coords(400f, 500f)), buttons = firstButtons))
                send(view, event(MotionEvent.ACTION_MOVE, 11, arrayOf(pointer), arrayOf(coords(450f, 500f)), buttons = laterButtons))
                send(view, event(MotionEvent.ACTION_UP, 12, arrayOf(pointer), arrayOf(coords(500f, 500f)), buttons = laterButtons))
                return result.single()
            }
            val primary = MotionEvent.BUTTON_STYLUS_PRIMARY
            val erased = stroke(MotionEvent.TOOL_TYPE_STYLUS, true, primary, 0)
            assertTrue(erased.erase); assertEquals(40.0, erased.brush.size, 0.0)
            assertFalse(stroke(MotionEvent.TOOL_TYPE_STYLUS, false, primary, primary).erase)
            assertFalse(stroke(MotionEvent.TOOL_TYPE_STYLUS, true, 0, primary).erase)
            assertFalse(stroke(MotionEvent.TOOL_TYPE_STYLUS, true, MotionEvent.BUTTON_STYLUS_SECONDARY, 0).erase)
            assertFalse(stroke(MotionEvent.TOOL_TYPE_FINGER, true, primary, primary).erase)
            assertTrue(stroke(MotionEvent.TOOL_TYPE_ERASER, false, 0, 0).erase)
        }
    }

    @Test @SdkSuppress(minSdkVersion = 33) fun canceledSecondPointerRollsBackNavigationAndFingerDraft() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext)
            view.layout(0, 0, 1000, 1000)
            val complete = mutableListOf<PendingStroke>(); var gesture = false
            view.complete = complete::add; view.gestureChanged = { gesture = it }
            val p1 = properties(1, MotionEvent.TOOL_TYPE_FINGER); val p2 = properties(2, MotionEvent.TOOL_TYPE_FINGER)
            send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(p1), arrayOf(coords(300f, 500f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 11, arrayOf(p1, p2), arrayOf(coords(300f, 500f), coords(500f, 500f))))
            send(view, event(MotionEvent.ACTION_MOVE, 12, arrayOf(p1, p2), arrayOf(coords(200f, 520f), coords(600f, 520f))))
            assertTrue(view.viewport.zoom > 1.5)
            send(view, event(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 13, arrayOf(p1, p2), arrayOf(coords(200f, 520f), coords(600f, 520f)), MotionEvent.FLAG_CANCELED))
            send(view, event(MotionEvent.ACTION_UP, 14, arrayOf(p1), arrayOf(coords(200f, 520f))))
            assertEquals(DrawingViewport(), view.viewport)
            assertTrue(complete.isEmpty()); assertFalse(gesture)
        }
    }

    @Test fun penTakesPriorityOverAnExistingTouchWithoutSavingTheTouch() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext)
            view.layout(0, 0, 1000, 1000)
            val complete = mutableListOf<PendingStroke>(); view.complete = complete::add
            val finger = properties(1, MotionEvent.TOOL_TYPE_FINGER); val pen = properties(4, MotionEvent.TOOL_TYPE_STYLUS)
            send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(finger), arrayOf(coords(100f, 300f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 11, arrayOf(finger, pen), arrayOf(coords(100f, 300f), coords(400f, 500f))))
            send(view, event(MotionEvent.ACTION_MOVE, 12, arrayOf(finger, pen), arrayOf(coords(110f, 310f), coords(440f, 500f))))
            send(view, event(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 13, arrayOf(finger, pen), arrayOf(coords(110f, 310f), coords(450f, 500f))))
            send(view, event(MotionEvent.ACTION_UP, 14, arrayOf(finger), arrayOf(coords(110f, 310f))))
            assertEquals(1, complete.size)
            assertEquals(3, complete.single().samples.size)
        }
    }

    @Test fun mouseWheelZoomKeepsThePointerOverTheSameScenePoint() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext)
            view.layout(0, 0, 1000, 1000)
            val before = view.viewport.transform(1000, 1000)
            val props = properties(1, MotionEvent.TOOL_TYPE_MOUSE)
            val point = coords(250f, 400f).apply { setAxisValue(MotionEvent.AXIS_VSCROLL, 2f) }
            val scroll = MotionEvent.obtain(1, 10, MotionEvent.ACTION_SCROLL, 1, arrayOf(props), arrayOf(point), 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_MOUSE, 0)
            try { assertTrue(view.onGenericMotionEvent(scroll)) } finally { scroll.recycle() }
            val after = view.viewport.transform(1000, 1000)
            assertTrue(view.viewport.zoom > 1.0)
            assertEquals(before.sceneX(250.0), after.sceneX(250.0), 1e-9)
            assertEquals(before.sceneY(400.0), after.sceneY(400.0), 1e-9)
        }
    }
    @Test fun penContinuesWhileTwoFingersNavigateAndGestureRemainsActive() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext); view.layout(0, 0, 1000, 1000)
            val complete = mutableListOf<PendingStroke>(); var gesture = false
            view.complete = complete::add; view.gestureChanged = { gesture = it }
            val pen = properties(4, MotionEvent.TOOL_TYPE_STYLUS); val a = properties(1, MotionEvent.TOOL_TYPE_FINGER); val b = properties(2, MotionEvent.TOOL_TYPE_FINGER)
            send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(pen), arrayOf(coords(450f, 500f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 11, arrayOf(pen, a), arrayOf(coords(450f, 500f), coords(300f, 600f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (2 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 12, arrayOf(pen, a, b), arrayOf(coords(450f, 500f), coords(300f, 600f), coords(500f, 600f))))
            send(view, event(MotionEvent.ACTION_MOVE, 13, arrayOf(pen, a, b), arrayOf(coords(480f, 500f), coords(200f, 600f), coords(600f, 600f))))
            assertTrue(view.viewport.zoom > 1.5); assertTrue(gesture)
            send(view, event(MotionEvent.ACTION_POINTER_UP, 14, arrayOf(pen, a, b), arrayOf(coords(500f, 500f), coords(200f, 600f), coords(600f, 600f))))
            assertTrue(complete.isEmpty()); assertTrue(gesture)
            val transformAtLift = view.viewport.transform(1000, 1000)
            send(view, event(MotionEvent.ACTION_MOVE, 15, arrayOf(a, b), arrayOf(coords(150f, 600f), coords(650f, 600f))))
            send(view, event(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 16, arrayOf(a, b), arrayOf(coords(150f, 600f), coords(650f, 600f))))
            assertEquals(1, complete.size); assertTrue(complete.single().samples.size >= 3)
            assertEquals(transformAtLift.sceneX(500.0), complete.single().samples.last().x, 1e-6)
            assertEquals(transformAtLift.sceneY(500.0), complete.single().samples.last().y, 1e-6)
            assertFalse(gesture)
            send(view, event(MotionEvent.ACTION_UP, 16, arrayOf(a), arrayOf(coords(200f, 600f))))
            assertEquals(1, complete.size)
        }
    }
    @Test @SdkSuppress(minSdkVersion = 33) fun canceledTouchNavigationRestoresViewportWithoutCancelingPen() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext); view.layout(0, 0, 1000, 1000)
            val complete = mutableListOf<PendingStroke>(); var gesture = false
            view.complete = complete::add; view.gestureChanged = { gesture = it }
            val pen = properties(4, MotionEvent.TOOL_TYPE_STYLUS); val a = properties(1, MotionEvent.TOOL_TYPE_FINGER); val b = properties(2, MotionEvent.TOOL_TYPE_FINGER)
            send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(pen), arrayOf(coords(450f, 500f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 11, arrayOf(pen, a), arrayOf(coords(450f, 500f), coords(300f, 600f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (2 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 12, arrayOf(pen, a, b), arrayOf(coords(450f, 500f), coords(300f, 600f), coords(500f, 600f))))
            send(view, event(MotionEvent.ACTION_MOVE, 13, arrayOf(pen, a, b), arrayOf(coords(480f, 500f), coords(200f, 600f), coords(600f, 600f))))
            send(view, event(MotionEvent.ACTION_POINTER_UP or (2 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 14, arrayOf(pen, a, b), arrayOf(coords(480f, 500f), coords(200f, 600f), coords(600f, 600f)), MotionEvent.FLAG_CANCELED))
            assertEquals(DrawingViewport(), view.viewport); assertTrue(gesture); assertTrue(complete.isEmpty())
            send(view, event(MotionEvent.ACTION_POINTER_UP, 15, arrayOf(pen, a), arrayOf(coords(500f, 500f), coords(200f, 600f))))
            send(view, event(MotionEvent.ACTION_UP, 16, arrayOf(a), arrayOf(coords(200f, 600f))))
            assertEquals(1, complete.size); assertFalse(gesture)
            val points = complete.single().samples
            val restored = DrawingViewport().transform(1000, 1000)
            assertEquals(restored.sceneX(450.0), points.first().x, 1e-6)
            assertEquals(restored.sceneX(480.0), points[1].x, 1e-6)
            assertEquals(restored.sceneX(500.0), points.last().x, 1e-6)
        }
    }
    @Test @SdkSuppress(minSdkVersion = 33) fun canceledNavigationAfterPenUpReprojectsBeforeCommit() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext); view.layout(0, 0, 1000, 1000)
            val complete = mutableListOf<PendingStroke>(); view.complete = complete::add
            val pen = properties(4, MotionEvent.TOOL_TYPE_STYLUS); val a = properties(1, MotionEvent.TOOL_TYPE_FINGER); val b = properties(2, MotionEvent.TOOL_TYPE_FINGER)
            send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(pen), arrayOf(coords(450f, 500f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 11, arrayOf(pen, a), arrayOf(coords(450f, 500f), coords(300f, 600f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (2 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 12, arrayOf(pen, a, b), arrayOf(coords(450f, 500f), coords(300f, 600f), coords(500f, 600f))))
            send(view, event(MotionEvent.ACTION_MOVE, 13, arrayOf(pen, a, b), arrayOf(coords(480f, 500f), coords(200f, 600f), coords(600f, 600f))))
            send(view, event(MotionEvent.ACTION_POINTER_UP, 14, arrayOf(pen, a, b), arrayOf(coords(500f, 500f), coords(200f, 600f), coords(600f, 600f))))
            assertTrue(complete.isEmpty())
            send(view, event(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 15, arrayOf(a, b), arrayOf(coords(200f, 600f), coords(600f, 600f)), MotionEvent.FLAG_CANCELED))
            assertEquals(DrawingViewport(), view.viewport); assertEquals(1, complete.size)
            val restored = DrawingViewport().transform(1000, 1000)
            assertEquals(restored.sceneX(480.0), complete.single().samples[1].x, 1e-6)
            assertEquals(restored.sceneX(500.0), complete.single().samples.last().x, 1e-6)
            send(view, event(MotionEvent.ACTION_UP, 16, arrayOf(a), arrayOf(coords(200f, 600f))))
        }
    }
    @Test fun newPenContactCannotBeginBeforeDeferredStrokeIsHandedOff() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext); view.layout(0, 0, 1000, 1000)
            val complete = mutableListOf<PendingStroke>(); view.complete = complete::add
            val pen = properties(4, MotionEvent.TOOL_TYPE_STYLUS); val nextPen = properties(5, MotionEvent.TOOL_TYPE_STYLUS)
            val a = properties(1, MotionEvent.TOOL_TYPE_FINGER); val b = properties(2, MotionEvent.TOOL_TYPE_FINGER)
            send(view, event(MotionEvent.ACTION_DOWN, 10, arrayOf(pen), arrayOf(coords(450f, 500f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 11, arrayOf(pen, a), arrayOf(coords(450f, 500f), coords(300f, 600f))))
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (2 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 12, arrayOf(pen, a, b), arrayOf(coords(450f, 500f), coords(300f, 600f), coords(500f, 600f))))
            send(view, event(MotionEvent.ACTION_POINTER_UP, 13, arrayOf(pen, a, b), arrayOf(coords(500f, 500f), coords(300f, 600f), coords(500f, 600f))))
            assertTrue(complete.isEmpty())
            send(view, event(MotionEvent.ACTION_POINTER_DOWN or (2 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 14, arrayOf(a, b, nextPen), arrayOf(coords(300f, 600f), coords(500f, 600f), coords(520f, 500f))))
            assertEquals(1, complete.size); assertFalse(view.canDraw)
            send(view, event(MotionEvent.ACTION_POINTER_UP or (2 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 15, arrayOf(a, b, nextPen), arrayOf(coords(300f, 600f), coords(500f, 600f), coords(530f, 500f))))
            assertEquals(1, complete.size)
        }
    }
    @Test fun stylusHoverDrawsAndClearsOnlyTheCursor() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = InkView(InstrumentationRegistry.getInstrumentation().targetContext); view.layout(0, 0, 1000, 1000)
            val pen = properties(4, MotionEvent.TOOL_TYPE_STYLUS)
            fun frame(): android.graphics.Bitmap = android.graphics.Bitmap.createBitmap(1000, 1000, android.graphics.Bitmap.Config.ARGB_8888).also { view.draw(android.graphics.Canvas(it)) }
            val before = frame(); val enter = event(MotionEvent.ACTION_HOVER_ENTER, 10, arrayOf(pen), arrayOf(coords(500f, 500f)))
            try { assertTrue(view.onHoverEvent(enter)) } finally { enter.recycle() }
            assertTrue(view.isStylusHovering)
            val during = frame(); assertNotEquals(before.getPixel(505, 500), during.getPixel(505, 500))
            val exit = event(MotionEvent.ACTION_HOVER_EXIT, 11, arrayOf(pen), arrayOf(coords(500f, 500f)))
            try { assertTrue(view.onHoverEvent(exit)) } finally { exit.recycle() }
            assertFalse(view.isStylusHovering)
            val after = frame(); assertEquals(before.getPixel(505, 500), after.getPixel(505, 500))
            before.recycle(); during.recycle(); after.recycle()
        }
    }

}
