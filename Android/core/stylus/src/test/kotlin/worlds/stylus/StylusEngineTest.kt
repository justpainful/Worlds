package worlds.stylus

fun main() {
    val events = mutableListOf<StylusEvent>()
    val engine = WorldsStylusEngine(events::add)
    val a = StylusSample(3, 10, 1f, 2f, 0.7f, 0.2f, null, null, false, 32)
    val b = a.copy(pointerId = 8, eraser = true)
    engine.move(a)
    engine.start(a)
    engine.start(a)
    engine.start(b)
    engine.move(a.copy(timeMillis = 11, pressure = 0.8f))
    engine.end(a, canceled = true)
    engine.end(a)
    engine.hover(b)
    engine.hoverExit(b.pointerId)
    engine.cancelAll()
    check(events == listOf(
        StylusEvent.Start(a), StylusEvent.Start(b),
        StylusEvent.Move(a.copy(timeMillis = 11, pressure = 0.8f)),
        StylusEvent.Cancel(3), StylusEvent.Hover(b), StylusEvent.HoverExit(8), StylusEvent.Cancel(8),
    ))
    engine.cancelAll()
    check(events.size == 7)
    println("Stylus stream, cancellation, eraser and hover routing passed")
}
