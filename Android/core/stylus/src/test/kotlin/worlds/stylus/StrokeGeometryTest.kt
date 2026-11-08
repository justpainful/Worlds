package worlds.stylus

import org.junit.Assert.*
import org.junit.Test

class StrokeGeometryTest {
    @org.junit.Test fun pencilTipUsesInitialTiltAndNeutralFallback() {
        val neutral = pencilBrush(4.0, StrokeSample(0.0, 0.0, 1.0, 0.0, 0.0, 0.0))
        val tilted = pencilBrush(4.0, StrokeSample(0.0, 0.0, 0.5, 45.0, 45.0, 0.0))
        assertEquals("natural-pencil", neutral.kind); assertEquals(1.0, neutral.roundness, 0.0)
        assertEquals(45.0, tilted.angle, 0.0001); assertTrue(tilted.roundness < neutral.roundness)
        assertTrue(tilted.pressureSize && tilted.pressureOpacity)
        val fallback = pencilBrush(4.0, StrokeSample(0.0, 0.0, 1.0, Double.NaN, Double.NaN, 0.0))
        assertEquals(neutral, fallback)
    }
    private fun point(x: Double, pressure: Double = 1.0, y: Double = 0.0) = StrokeSample(x, y, pressure, 0.0, 0.0, x)

    @Test fun desktopUniformWidthAndTaperFixtures() {
        val points = listOf(point(0.0, 0.2), point(50.0, 0.5), point(100.0))
        val brush = StrokeBrush(size = 100.0, pressureCurve = 2.0)
        assertArrayEquals(doubleArrayOf(2.0, 12.5, 50.0), StrokeGeometry.uniformRadii(points, brush), 1e-9)
        assertArrayEquals(doubleArrayOf(50.0, 50.0, 50.0), StrokeGeometry.uniformRadii(points, brush.copy(pressureSize = false)), 1e-9)
        val taper = brush.copy(pressureSize = false, taperStart = 0.2, taperEnd = 0.2)
        assertArrayEquals(doubleArrayOf(1.5, 25.0, 25.0, 1.5), StrokeGeometry.uniformRadii(listOf(point(0.0), point(10.0), point(90.0), point(100.0)), taper), 1e-9)
    }

    @Test fun desktopSpacingFixtureIncludesEndpointAsDesktopDoes() {
        val brush = StrokeBrush(size = 10.0, spacing = 0.2, pressureSize = false)
        val dabs = StrokeGeometry.dabs(listOf(point(0.0), point(4.0)), brush).toList()
        assertEquals(listOf(0.0, 2.0, 4.0, 4.0), dabs.map { it.x })
        assertTrue(dabs.all { it.size == 10.0 })
    }

    @Test fun straightProjectionPreservesPressureAndInput() {
        val source = listOf(point(0.0, 0.2), point(50.0, 0.6, 40.0), point(100.0))
        val straight = StrokeGeometry.straight(source, true)
        assertEquals(listOf(0.0, 50.0, 100.0), straight.map { it.x })
        assertEquals(listOf(0.0, 0.0, 0.0), straight.map { it.y })
        assertEquals(source.map { it.pressure }, straight.map { it.pressure })
        assertEquals(40.0, source[1].y, 0.0)
    }

    @Test fun boundedSprayRetainsAcceptedSamplesAndRejectsHostileInputs() {
        val brush = StrokeBrush(kind = "spray", size = 2048.0, spacing = 0.01)
        val input = StrokeInput(point(0.0), brush)
        assertTrue(input.append(point(100.0)))
        assertFalse(input.append(point(10000.0)))
        assertTrue(input.limited)
        assertFalse(input.append(point(101.0)))
        assertEquals(listOf(0.0, 100.0), input.samples.map { it.x })
        assertTrue(runCatching { StrokeGeometry.dabs(listOf(point(0.0), point(10000.0)), brush).first() }.isFailure)
        assertTrue(runCatching { StrokeInput(point(Double.NaN), brush) }.isFailure)
        assertEquals(26.0, StrokeGeometry.workForLength(0.0, StrokeBrush(kind = "oil")), 0.0)
    }

    @Test fun seededSprayAndBrushNormalizationAreDeterministic() {
        val brush = StrokeBrush(kind = "spray", size = 12.0, spacing = 0.2)
        val points = listOf(point(0.0, 0.5), point(4.0))
        val first = StrokeGeometry.dabs(points, brush, 42).toList()
        assertEquals(first, StrokeGeometry.dabs(points, brush, 42).toList())
        assertNotEquals(first, StrokeGeometry.dabs(points, brush, 43).toList())
        assertEquals(12.0, StrokeBrush(size = Double.NaN).normalized().size, 0.0)
        assertEquals(2048.0, StrokeBrush(size = 9000.0).normalized().size, 0.0)
        assertEquals("hard", StrokeBrush(kind = "unknown").normalized().kind)
    }

    @Test fun matchesGeneratedDesktopDabFixtures() {
        val fixtures = requireNotNull(javaClass.getResourceAsStream("/desktop-brush-fixtures.tsv"))
            .bufferedReader().readLines().filter { it.isNotBlank() }.groupBy { it.substringBefore('\t') }
        val points = listOf(StrokeSample(0.0, 1.0, 0.2, 0.0, 0.0, 0.0), StrokeSample(3.0, 5.0, 0.6, 0.0, 0.0, 12.0), StrokeSample(8.0, 5.0, 1.0, 0.0, 0.0, 30.0))
        val cases = mapOf(
            "hard" to StrokeBrush(size = 10.0, spacing = 0.2, flow = 0.8, pressureCurve = 2.0, pressureOpacity = true, taperStart = 0.2, taperEnd = 0.3),
            "spray" to StrokeBrush(kind = "spray", size = 10.0, spacing = 0.3, pressureFlow = true, angle = 35.0),
        )
        for ((name, brush) in cases) {
            val expected = requireNotNull(fixtures[name]).map { it.split('\t').drop(1).map(String::toDouble).toDoubleArray() }
            val actual = StrokeGeometry.dabs(points, brush, 42).map { doubleArrayOf(it.x, it.y, it.size, it.opacity, it.angle, it.roundness, it.noise) }.toList()
            assertEquals(name, expected.size, actual.size)
            expected.zip(actual).forEach { (a, b) -> assertArrayEquals(name, a, b, 1e-9) }
        }
    }
}
