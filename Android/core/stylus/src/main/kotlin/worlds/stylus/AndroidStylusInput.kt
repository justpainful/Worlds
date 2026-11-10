package worlds.stylus

import android.view.MotionEvent
import android.os.Build

/** Translate native events, including batched samples, into the reusable engine. */
class AndroidStylusInput(private val engine: WorldsStylusEngine) {
    fun onMotionEvent(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val i = event.actionIndex
                if (event.isPen(i)) engine.start(event.sample(i))
            }
            MotionEvent.ACTION_MOVE -> {
                for (h in 0 until event.historySize) {
                    for (i in 0 until event.pointerCount) if (event.isPen(i)) engine.move(event.sample(i, h))
                }
                for (i in 0 until event.pointerCount) if (event.isPen(i)) engine.move(event.sample(i))
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val i = event.actionIndex
                val canceled = Build.VERSION.SDK_INT >= 33 && event.flags and MotionEvent.FLAG_CANCELED != 0
                if (event.isPen(i)) engine.end(event.sample(i), canceled)
            }
            MotionEvent.ACTION_CANCEL -> engine.cancelAll()
            MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> {
                for (i in 0 until event.pointerCount) if (event.isPen(i)) engine.hover(event.sample(i))
            }
            MotionEvent.ACTION_HOVER_EXIT -> {
                for (i in 0 until event.pointerCount) if (event.isPen(i)) engine.hoverExit(event.getPointerId(i))
            }
        }
    }

    private fun MotionEvent.isPen(index: Int): Boolean =
        getToolType(index) == MotionEvent.TOOL_TYPE_STYLUS || getToolType(index) == MotionEvent.TOOL_TYPE_ERASER

    private fun MotionEvent.sample(index: Int, history: Int? = null): StylusSample {
        fun axis(axis: Int): Float? {
            val input = device ?: return null
            if (input.getMotionRange(axis, source) == null && input.getMotionRange(axis) == null) return null
            return if (history == null) getAxisValue(axis, index) else getHistoricalAxisValue(axis, index, history)
        }
        return StylusSample(
            pointerId = getPointerId(index),
            timeMillis = if (history == null) eventTime else getHistoricalEventTime(history),
            x = if (history == null) getX(index) else getHistoricalX(index, history),
            y = if (history == null) getY(index) else getHistoricalY(index, history),
            pressure = axis(MotionEvent.AXIS_PRESSURE),
            tiltRadians = axis(MotionEvent.AXIS_TILT),
            orientationRadians = axis(MotionEvent.AXIS_ORIENTATION),
            distance = axis(MotionEvent.AXIS_DISTANCE),
            eraser = getToolType(index) == MotionEvent.TOOL_TYPE_ERASER,
            buttons = buttonState,
        )
    }
}
