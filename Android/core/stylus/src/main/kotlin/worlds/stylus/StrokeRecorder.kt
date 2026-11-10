package worlds.stylus

/** One in-progress pen stroke. Raw input remains available to the caller for device diagnostics. */
sealed interface StrokeRecordingEvent {
    data class Started(val pointerId: Int, val eraser: Boolean, val first: StrokeSample) : StrokeRecordingEvent
    data class Sampled(val pointerId: Int, val sample: StrokeSample) : StrokeRecordingEvent
    data class LimitReached(val pointerId: Int) : StrokeRecordingEvent
    data class Completed(val pointerId: Int, val eraser: Boolean, val brush: StrokeBrush, val samples: List<StrokeSample>, val limited: Boolean) : StrokeRecordingEvent
    data class Canceled(val pointerId: Int) : StrokeRecordingEvent
}

/** Bridges routed pen events into bounded scene-space samples without consuming touch events.
 * The caller supplies the coordinate transform and missing-axis policy explicitly. */
class StrokeRecorder(
    private val brushFor: (StylusSample) -> StrokeBrush,
    private val toScene: (StylusSample) -> StrokeSample,
    private val emit: (StrokeRecordingEvent) -> Unit,
    private val eraseFor: (StylusSample) -> Boolean = { it.eraser },
) {
    private data class Active(val eraser: Boolean, var input: StrokeInput, val raw: MutableList<StylusSample>)
    private val active = mutableMapOf<Int, Active>()

    fun onEvent(event: StylusEvent) {
        when (event) {
            is StylusEvent.Start -> {
                val id = event.sample.pointerId
                if (id !in active) {
                    val first = toScene(event.sample)
                    val stroke = StrokeInput(first, brushFor(event.sample))
                    val eraser = eraseFor(event.sample)
                    active[id] = Active(eraser, stroke, mutableListOf(event.sample))
                    emit(StrokeRecordingEvent.Started(id, eraser, first))
                }
            }
            is StylusEvent.Move -> append(event.sample)
            is StylusEvent.End -> {
                val id = event.sample.pointerId
                if (id !in active) return
                append(event.sample)
                finish(id)
            }
            is StylusEvent.Cancel -> if (active.remove(event.pointerId) != null) emit(StrokeRecordingEvent.Canceled(event.pointerId))
            is StylusEvent.Hover, is StylusEvent.HoverExit -> Unit
        }
    }
    /** Number of accepted samples, used to preserve the pre-gesture prefix. */
    fun checkpoint(pointerId: Int): Int? = active[pointerId]?.input?.samples?.size

    /** Rebuild only samples collected during a canceled viewport gesture, keeping work limits. */
    fun reprojectFrom(pointerId: Int, index: Int, transform: (StylusSample) -> StrokeSample): List<StrokeSample>? {
        val current = active[pointerId] ?: return null
        val old = current.input; val samples = old.samples
        require(index in 1..samples.size && current.raw.size == samples.size)
        val rebuilt = StrokeInput(samples.first(), old.brush)
        var accepted = 1
        for (i in 1 until samples.size) {
            val next = if (i >= index) transform(current.raw[i]) else samples[i]
            if (!rebuilt.append(next)) break
            accepted++
        }
        while (current.raw.size > accepted) current.raw.removeAt(current.raw.lastIndex)
        if (old.limited) rebuilt.stopAtLimit()
        current.input = rebuilt
        if (rebuilt.limited && !old.limited) emit(StrokeRecordingEvent.LimitReached(pointerId))
        return rebuilt.samples
    }

    /** Complete a sample already recorded at pen-up, without remapping it later. */
    fun finish(pointerId: Int) {
        val current = active.remove(pointerId) ?: return
        emit(StrokeRecordingEvent.Completed(pointerId, current.eraser, current.input.brush, current.input.samples, current.input.limited))
    }

    private fun append(sample: StylusSample) {
        val input = active[sample.pointerId]?.input ?: return
        if (input.limited) return
        val scene = toScene(sample)
        // A release at the same location and axes adds no geometry; keep changed pressure samples.
        if (input.lastSample == scene) return
        if (input.append(scene)) { active.getValue(sample.pointerId).raw.add(sample); emit(StrokeRecordingEvent.Sampled(sample.pointerId, scene)) }
        else emit(StrokeRecordingEvent.LimitReached(sample.pointerId))
    }
}
