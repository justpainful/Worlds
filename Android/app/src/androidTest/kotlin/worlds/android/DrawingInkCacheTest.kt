package worlds.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import worlds.stylus.StrokeBrush
import worlds.stylus.StrokeSample

@RunWith(AndroidJUnit4::class)
class DrawingInkCacheTest {
    private fun samples(x: Double, y: Double) = listOf(
        StrokeSample(x, y, 0.6, 0.0, 0.0, 1.0),
        StrokeSample(x + 60, y + 12, 0.9, 0.0, 0.0, 2.0),
    )
    private fun pixels(draw: (Canvas) -> Unit): IntArray {
        val bitmap = Bitmap.createBitmap(256, 144, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); canvas.scale(0.2f, 0.2f); draw(canvas)
        return IntArray(bitmap.width * bitmap.height).also { bitmap.getPixels(it, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height); bitmap.recycle() }
    }

    @Test fun cachedAndUncachedCompositingMatchAcrossBrushesAndErasers() {
        val strokes = listOf(
            InkStroke(samples(90.0, 100.0), StrokeBrush(size = 30.0), false, Color.BLUE),
            InkStroke(samples(85.0, 102.0), StrokeBrush(kind = "highlighter", size = 25.0, opacity = 0.35, pressureSize = false), false, Color.YELLOW),
            InkStroke(samples(90.0, 98.0), StrokeBrush(kind = "natural-pencil", size = 4.0, spacing = 0.18, flow = 0.65, opacity = 0.85, pressureOpacity = true), false, Color.BLACK),
            InkStroke(samples(100.0, 100.0), StrokeBrush(size = 12.0), true),
        )
        val reference = pixels { DrawingInk.draw(it, strokes) }
        for (split in 0..strokes.size) {
            val picture = requireNotNull(DrawingInk.record(strokes.take(split)))
            val actual = pixels { DrawingInk.drawCached(it, picture, strokes.drop(split)) }
            assertArrayEquals("Split $split must keep stroke ordering and eraser behavior", reference, actual)
        }
    }

    @Test fun excessiveRecordingFallsBackWithoutAllocatingPicture() {
        val longStroke = InkStroke(listOf(
            StrokeSample(0.0, 0.0, 1.0, 0.0, 0.0, 1.0),
            StrokeSample(1_000_000.0, 0.0, 1.0, 0.0, 0.0, 2.0),
        ), StrokeBrush(size = 1.0), false)
        assertNull(DrawingInk.record(listOf(longStroke)))
        val repeated = InkStroke(List(50_001) { StrokeSample(1.0, 1.0, 1.0, 0.0, 0.0, 1.0) }, StrokeBrush(), false)
        assertNull(DrawingInk.record(listOf(repeated, repeated)))
    }
}
