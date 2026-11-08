package worlds.android

import org.junit.Assert.*
import org.junit.Test

class SlideMoveTest {
    @Test fun hitTestingUsesTopmostAndRotation() {
        val back = SlideMoveTarget("back", 0.0, 0.0, 100.0, 100.0, 0.0)
        val front = SlideMoveTarget("front", 20.0, 40.0, 80.0, 20.0, 90.0)
        assertEquals("front", slideMoveHit(listOf(back, front), 60.0, 80.0)?.id)
        assertEquals("back", slideMoveHit(listOf(back, front), 25.0, 50.0)?.id)
        assertNull(slideMoveHit(listOf(front), 200.0, 200.0))
    }
    @Test fun rejectsAmbiguousIdsAndNonFiniteGeometry() {
        val target = SlideMoveTarget("same", 0.0, 0.0, 100.0, 100.0, 0.0)
        assertNull(slideMoveHit(listOf(target, target), 5.0, 5.0))
        assertNull(slideMoveHit(listOf(target.copy(x = Double.NaN)), 5.0, 5.0))
    }
    @Test fun resizingKeepsOppositeRotatedHandleFixed() {
        val item = SlideMoveTarget("shape", 100.0, 200.0, 300.0, 150.0, 37.0)
        val before = slideHandles(item).associateBy { it.name }
        val after = slideResize(item, "se", 60.0, 80.0)
        val handles = slideHandles(after).associateBy { it.name }
        assertEquals(before.getValue("nw").x, handles.getValue("nw").x, 1e-8)
        assertEquals(before.getValue("nw").y, handles.getValue("nw").y, 1e-8)
        assertTrue(after.width > item.width); assertTrue(after.height > item.height)
        val shrunk = slideResize(item, "e", -10000.0, 0.0)
        assertEquals(16.0, shrunk.width, 0.0); assertEquals(item.height, shrunk.height, 0.0)
    }
}
