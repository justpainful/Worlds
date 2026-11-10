package worlds.stylus

import org.junit.Assert.*
import org.junit.Test

class StrokeRecorderTest {
    private fun raw(id: Int, x: Float, time: Long, eraser: Boolean = false) = StylusSample(id, time, x, 2f, 0.7f, null, null, null, eraser, 0)
    private fun scene(s: StylusSample) = StrokeSample(s.x.toDouble() * 2, s.y.toDouble() * 2, requireNotNull(s.pressure).toDouble(), 0.0, 0.0, s.timeMillis.toDouble())

    @Test fun recordsIndependentPenAndEraserStreamsAndDropsCanceledStroke() {
        val events = mutableListOf<StrokeRecordingEvent>()
        val recorder = StrokeRecorder({ StrokeBrush() }, ::scene, events::add)
        val engine = WorldsStylusEngine(recorder::onEvent)
        engine.start(raw(1, 1f, 1)); engine.start(raw(2, 5f, 1, true))
        engine.move(raw(1, 3f, 2)); engine.end(raw(2, 6f, 3, true), canceled = true)
        engine.end(raw(1, 4f, 4))
        val completed = events.filterIsInstance<StrokeRecordingEvent.Completed>().single()
        assertEquals(listOf(2.0, 6.0, 8.0), completed.samples.map { it.x })
        assertFalse(completed.eraser)
        assertEquals(2, events.filterIsInstance<StrokeRecordingEvent.Started>().size)
        assertEquals(listOf(2), events.filterIsInstance<StrokeRecordingEvent.Canceled>().map { it.pointerId })
        assertTrue(events.none { it is StrokeRecordingEvent.Completed && it.pointerId == 2 })
    }

    @Test fun limitCommitsOnlyAcceptedSamplesAndNotifiesOnce() {
        val events = mutableListOf<StrokeRecordingEvent>()
        val recorder = StrokeRecorder({ StrokeBrush(kind = "spray", size = 2048.0, spacing = 0.01) }, ::scene, events::add)
        recorder.onEvent(StylusEvent.Start(raw(1, 0f, 1, true)))
        recorder.onEvent(StylusEvent.Move(raw(1, 50f, 2, true)))
        recorder.onEvent(StylusEvent.Move(raw(1, 10000f, 3, true)))
        recorder.onEvent(StylusEvent.Move(raw(1, 60f, 4, true)))
        recorder.onEvent(StylusEvent.End(raw(1, 60f, 5, true)))
        assertEquals(1, events.filterIsInstance<StrokeRecordingEvent.LimitReached>().size)
        val completed = events.filterIsInstance<StrokeRecordingEvent.Completed>().single()
        assertEquals(listOf(0.0, 100.0), completed.samples.map { it.x })
        assertTrue(completed.limited)
        assertTrue(completed.eraser)
    }
    @Test fun reprojectionPreservesPrefixAndFinishesWithoutNewSample() {
        val events = mutableListOf<StrokeRecordingEvent>()
        val recorder = StrokeRecorder({ StrokeBrush() }, ::scene, events::add)
        recorder.onEvent(StylusEvent.Start(raw(1, 1f, 1)))
        recorder.onEvent(StylusEvent.Move(raw(1, 2f, 2)))
        val checkpoint = requireNotNull(recorder.checkpoint(1))
        recorder.onEvent(StylusEvent.Move(raw(1, 3f, 3)))
        recorder.onEvent(StylusEvent.Move(raw(1, 4f, 4)))
        val corrected = recorder.reprojectFrom(1, checkpoint) { scene(it).copy(x = it.x.toDouble() * 3) }!!
        assertEquals(listOf(2.0, 4.0, 9.0, 12.0), corrected.map { it.x })
        recorder.finish(1)
        assertEquals(corrected, events.filterIsInstance<StrokeRecordingEvent.Completed>().single().samples)
    }
    @Test fun reprojectionRetainsWorkLimitAndTruncatesUnsafeSuffix() {
        val events = mutableListOf<StrokeRecordingEvent>()
        val recorder = StrokeRecorder({ StrokeBrush(kind = "spray", size = 2048.0, spacing = 0.01) }, ::scene, events::add)
        recorder.onEvent(StylusEvent.Start(raw(1, 0f, 1)))
        val checkpoint = requireNotNull(recorder.checkpoint(1))
        recorder.onEvent(StylusEvent.Move(raw(1, 30f, 2)))
        val corrected = recorder.reprojectFrom(1, checkpoint) { scene(it).copy(x = 1e9) }!!
        assertEquals(1, corrected.size)
        recorder.onEvent(StylusEvent.Move(raw(1, 1f, 3)))
        recorder.finish(1)
        val completed = events.filterIsInstance<StrokeRecordingEvent.Completed>().single()
        assertTrue(completed.limited); assertEquals(1, completed.samples.size)
        assertEquals(1, events.filterIsInstance<StrokeRecordingEvent.LimitReached>().size)
    }

}
