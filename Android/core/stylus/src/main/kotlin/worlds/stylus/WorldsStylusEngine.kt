package worlds.stylus

/** Raw device coordinates and axes. Missing optional axes stay null rather than being guessed. */
data class StylusSample(
    val pointerId: Int,
    val timeMillis: Long,
    val x: Float,
    val y: Float,
    val pressure: Float?,
    val tiltRadians: Float?,
    val orientationRadians: Float?,
    val distance: Float?,
    val eraser: Boolean,
    val buttons: Int,
)

sealed interface StylusEvent {
    data class Start(val sample: StylusSample) : StylusEvent
    data class Move(val sample: StylusSample) : StylusEvent
    data class End(val sample: StylusSample) : StylusEvent
    data class Cancel(val pointerId: Int) : StylusEvent
    data class Hover(val sample: StylusSample) : StylusEvent
    data class HoverExit(val pointerId: Int) : StylusEvent
}

/** Routes pen streams without taking ownership of finger, mouse, or keyboard input. */
class WorldsStylusEngine(private val emit: (StylusEvent) -> Unit) {
    private val active = mutableSetOf<Int>()

    fun start(sample: StylusSample) {
        if (active.add(sample.pointerId)) emit(StylusEvent.Start(sample))
    }

    fun move(sample: StylusSample) {
        if (sample.pointerId in active) emit(StylusEvent.Move(sample))
    }

    fun end(sample: StylusSample, canceled: Boolean = false) {
        if (active.remove(sample.pointerId)) {
            emit(if (canceled) StylusEvent.Cancel(sample.pointerId) else StylusEvent.End(sample))
        }
    }

    fun cancelAll() {
        val canceled = active.toList()
        active.clear()
        canceled.forEach { emit(StylusEvent.Cancel(it)) }
    }

    fun hover(sample: StylusSample) = emit(StylusEvent.Hover(sample))
    fun hoverExit(pointerId: Int) = emit(StylusEvent.HoverExit(pointerId))
}
