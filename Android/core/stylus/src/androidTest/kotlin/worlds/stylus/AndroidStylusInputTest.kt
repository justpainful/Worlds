package worlds.stylus

import android.view.InputDevice
import android.view.MotionEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidStylusInputTest {
    private fun event(action: Int, time: Long, tool: Int, x: Float): MotionEvent {
        val properties = MotionEvent.PointerProperties().apply { id = 4; toolType = tool }
        val coords = MotionEvent.PointerCoords().apply { this.x = x; y = 2f; pressure = 0.6f }
        return MotionEvent.obtain(1, time, action, 1, arrayOf(properties), arrayOf(coords),
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
    }

    @Test fun penMoveIncludesBatchedHistoryAndCancel() {
        val observed = mutableListOf<StylusEvent>()
        val input = AndroidStylusInput(WorldsStylusEngine(observed::add))
        val down = event(MotionEvent.ACTION_DOWN, 10, MotionEvent.TOOL_TYPE_STYLUS, 1f)
        val move = event(MotionEvent.ACTION_MOVE, 11, MotionEvent.TOOL_TYPE_STYLUS, 2f)
        val next = MotionEvent.PointerCoords().apply { x = 3f; y = 2f; pressure = 0.7f }
        move.addBatch(12, arrayOf(next), 0)
        val cancel = event(MotionEvent.ACTION_CANCEL, 13, MotionEvent.TOOL_TYPE_STYLUS, 3f)
        try {
            input.onMotionEvent(down); input.onMotionEvent(move); input.onMotionEvent(cancel)
            assertEquals(4, observed.size)
            assertEquals(1f, (observed[0] as StylusEvent.Start).sample.x)
            assertEquals(2f, (observed[1] as StylusEvent.Move).sample.x)
            assertEquals(3f, (observed[2] as StylusEvent.Move).sample.x)
            assertEquals(StylusEvent.Cancel(4), observed[3])
        } finally { down.recycle(); move.recycle(); cancel.recycle() }
    }

    @Test fun fingerIsIgnoredAndEraserIsIdentified() {
        val observed = mutableListOf<StylusEvent>()
        val input = AndroidStylusInput(WorldsStylusEngine(observed::add))
        val finger = event(MotionEvent.ACTION_DOWN, 10, MotionEvent.TOOL_TYPE_FINGER, 1f)
        val eraser = event(MotionEvent.ACTION_DOWN, 11, MotionEvent.TOOL_TYPE_ERASER, 1f)
        try {
            input.onMotionEvent(finger)
            assertTrue(observed.isEmpty())
            input.onMotionEvent(eraser)
            assertTrue((observed.single() as StylusEvent.Start).sample.eraser)
        } finally { finger.recycle(); eraser.recycle() }
    }

    @Test fun nativeEventsReachBoundedStrokeRecorderInOrder() {
        val recorded = mutableListOf<StrokeRecordingEvent>()
        val recorder = StrokeRecorder({ StrokeBrush(size = 8.0) }, { sample ->
            // Synthetic MotionEvents have no InputDevice motion ranges; use a test-only fallback.
            StrokeSample(sample.x.toDouble(), sample.y.toDouble(), sample.pressure?.toDouble() ?: 1.0, 0.0, 0.0, sample.timeMillis.toDouble())
        }, recorded::add)
        val input = AndroidStylusInput(WorldsStylusEngine(recorder::onEvent))
        val down = event(MotionEvent.ACTION_DOWN, 10, MotionEvent.TOOL_TYPE_STYLUS, 1f)
        val move = event(MotionEvent.ACTION_MOVE, 11, MotionEvent.TOOL_TYPE_STYLUS, 2f)
        move.addBatch(12, arrayOf(MotionEvent.PointerCoords().apply { x = 3f; y = 2f; pressure = 0.7f }), 0)
        val up = event(MotionEvent.ACTION_UP, 13, MotionEvent.TOOL_TYPE_STYLUS, 4f)
        try {
            input.onMotionEvent(down); input.onMotionEvent(move); input.onMotionEvent(up)
            val stroke = recorded.filterIsInstance<StrokeRecordingEvent.Completed>().single()
            assertEquals(listOf(1.0, 2.0, 3.0, 4.0), stroke.samples.map { it.x })
            assertTrue(StrokeGeometry.dabs(stroke.samples, stroke.brush).count() > 4)
        } finally { down.recycle(); move.recycle(); up.recycle() }
    }

    @Test @SdkSuppress(minSdkVersion = 33) fun mixedPointersRoutePenAndCancelOnlyThatStroke() {
        val observed = mutableListOf<StylusEvent>()
        val input = AndroidStylusInput(WorldsStylusEngine(observed::add))
        val finger = MotionEvent.PointerProperties().apply { id = 1; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val pen = MotionEvent.PointerProperties().apply { id = 4; toolType = MotionEvent.TOOL_TYPE_STYLUS }
        val fingerCoords = MotionEvent.PointerCoords().apply { x = 50f; y = 60f }
        val penCoords = MotionEvent.PointerCoords().apply { x = 2f; y = 3f; pressure = 0.4f }
        fun mixed(action: Int, time: Long, flags: Int = 0) = MotionEvent.obtain(
            1, time, action, 2, arrayOf(finger, pen), arrayOf(fingerCoords, penCoords),
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, flags,
        )
        val down = mixed(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 10)
        val move = mixed(MotionEvent.ACTION_MOVE, 11)
        val up = mixed(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), 12, MotionEvent.FLAG_CANCELED)
        try {
            input.onMotionEvent(down); input.onMotionEvent(move); input.onMotionEvent(up)
            assertEquals(3, observed.size)
            assertEquals(4, (observed[0] as StylusEvent.Start).sample.pointerId)
            assertEquals(4, (observed[1] as StylusEvent.Move).sample.pointerId)
            assertEquals(StylusEvent.Cancel(4), observed[2])
        } finally { down.recycle(); move.recycle(); up.recycle() }
    }
}
