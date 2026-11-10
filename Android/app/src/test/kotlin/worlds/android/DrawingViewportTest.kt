package worlds.android

import org.junit.Assert.*
import org.junit.Test

class DrawingViewportTest {
    @Test fun pinchKeepsScenePointUnderMovingFingers() {
        val before = DrawingViewport()
        val old = before.transform(1000, 1400)
        val after = before.zoomAround(1000, 1400, 400.0, 700.0, 450.0, 740.0, 2.0)
        val next = after.transform(1000, 1400)
        assertEquals(2.0, after.zoom, 1e-10)
        assertEquals(old.sceneX(400.0), next.sceneX(450.0), 1e-9)
        assertEquals(old.sceneY(700.0), next.sceneY(740.0), 1e-9)
    }

    @Test fun panResizeAndFitPreserveExpectedCoordinates() {
        val initial = DrawingViewport()
        val moved = initial.zoomAround(800, 600, 400.0, 300.0, 500.0, 350.0, 1.0)
        assertEquals(480.0, moved.centerX, 1e-9)
        assertEquals(280.0, moved.centerY, 1e-9)
        val resized = moved.transform(1200, 700)
        assertEquals(moved.centerX, resized.sceneX(600.0), 1e-9)
        assertEquals(moved.centerY, resized.sceneY(350.0), 1e-9)
        assertEquals(640.0, DrawingViewport().transform(800, 600).sceneX(400.0), 1e-9)
    }

    @Test fun rejectsInvalidChangesAndClampsZoom() {
        val initial = DrawingViewport()
        assertEquals(initial, initial.zoomAround(800, 600, 0.0, 0.0, 0.0, 0.0, Double.NaN))
        assertEquals(initial, initial.zoomCentered(-1.0))
        assertEquals(16.0, initial.zoomCentered(100.0).zoom, 0.0)
        assertEquals(0.5, initial.zoomCentered(0.01).zoom, 0.0)
    }
}
