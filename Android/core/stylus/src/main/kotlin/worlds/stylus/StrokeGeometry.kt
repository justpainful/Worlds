package worlds.stylus

import kotlin.math.*

/** The geometry fields used by the desktop drawing model, in scene coordinates. */
data class StrokeSample(val x: Double, val y: Double, val pressure: Double, val tiltX: Double, val tiltY: Double, val time: Double) {
    internal fun finite() = listOf(x, y, pressure, tiltX, tiltY, time).all { it.isFinite() }
}

data class StrokeBrush(
    val kind: String = "hard", val size: Double = 12.0, val spacing: Double = 0.12,
    val flow: Double = 1.0, val angle: Double = 0.0, val roundness: Double = 1.0,
    val smoothing: Double = 0.15, val stabilizer: Double = 0.0,
    val taperStart: Double = 0.0, val taperEnd: Double = 0.0,
    val pressureSize: Boolean = true, val pressureOpacity: Boolean = false,
    val pressureFlow: Boolean = false, val pressureCurve: Double = 1.0,
    val opacity: Double = 1.0, val straightLine: Boolean = false,
) {
    fun normalized(): StrokeBrush {
        fun n(value: Double, fallback: Double, min: Double, max: Double) = if (value.isFinite()) value.coerceIn(min, max) else fallback
        return copy(kind = if (kind in KINDS) kind else "hard", size = n(size, 12.0, 1.0, 2048.0),
            spacing = n(spacing, 0.12, 0.01, 2.0), flow = n(flow, 1.0, 0.0, 1.0),
            angle = n(angle, 0.0, -360.0, 360.0), roundness = n(roundness, 1.0, 0.05, 1.0),
            smoothing = n(smoothing, 0.15, 0.0, 0.95), stabilizer = n(stabilizer, 0.0, 0.0, 100.0),
            taperStart = n(taperStart, 0.0, 0.0, 0.5), taperEnd = n(taperEnd, 0.0, 0.0, 0.5),
            pressureCurve = n(pressureCurve, 1.0, 0.1, 4.0), opacity = n(opacity, 1.0, 0.0, 1.0))
    }
    companion object { private val KINDS = setOf("pencil", "hard", "soft", "ink", "marker", "highlighter", "spray", "texture", "calligraphy", "oil", "crayon", "natural-pencil", "watercolor") }
}

data class StrokeDab(val x: Double, val y: Double, val size: Double, val opacity: Double, val angle: Double, val roundness: Double, val noise: Double)

/** Fix the tip geometry at pen down so desktop and Android replay the same stroke. */
fun pencilBrush(width: Double, first: StrokeSample): StrokeBrush {
    val x = first.tiltX.takeIf { it.isFinite() } ?: 0.0
    val y = first.tiltY.takeIf { it.isFinite() } ?: 0.0
    val tilt = hypot(x, y).coerceIn(0.0, 90.0)
    val angle = if (tilt < 0.01) 0.0 else Math.toDegrees(atan2(y, x))
    return StrokeBrush(kind = "natural-pencil", size = width, spacing = 0.18, flow = 0.65, opacity = 0.85,
        pressureOpacity = true, angle = angle, roundness = 1.0 - 0.65 * tilt / 90.0).normalized()
}

/** Port of desktop brushWork.ts, brush.ts and uniformStroke.ts geometry. */
object StrokeGeometry {
    const val MAX_SAMPLES = 65536
    const val MAX_WORK = 1000000.0
    private fun distance(a: StrokeSample, b: StrokeSample) = hypot(b.x - a.x, b.y - a.y)
    fun workForLength(length: Double, brush: StrokeBrush): Double {
        val spacing = max(0.25, brush.size * brush.spacing * if (brush.pressureSize) 0.1 else 1.0)
        val pigment = when (brush.kind) {
            "spray" -> max(1.0, ceil(brush.size / 3))
            "crayon", "natural-pencil" -> min(256.0, max(5.0, ceil(brush.size * if (brush.kind == "crayon") 5 else 4)))
            "oil" -> 13.0
            "watercolor" -> 2.0
            else -> 1.0
        }
        return (2 + length / spacing) * pigment
    }
    fun requireBudget(samples: List<StrokeSample>, brush: StrokeBrush) {
        require(samples.size <= MAX_SAMPLES && samples.all { it.finite() }) { "Stroke exceeds paint limit" }
        val length = samples.zipWithNext().sumOf { (a, b) -> distance(a, b) }
        require(samples.isEmpty() || workForLength(length, brush) <= MAX_WORK) { "Stroke exceeds paint limit" }
    }
    fun smooth(previous: StrokeSample, next: StrokeSample, raw: StrokeBrush): StrokeSample {
        val b = raw.normalized(); val d = distance(previous, next)
        if (d == 0.0) return next
        val a = (1 - b.smoothing) * if (b.stabilizer != 0.0) min(1.0, d / b.stabilizer) else 1.0
        return next.copy(x = previous.x + (next.x - previous.x) * a, y = previous.y + (next.y - previous.y) * a)
    }
    fun straight(samples: List<StrokeSample>, enabled: Boolean): List<StrokeSample> {
        if (!enabled || samples.size < 2) return samples
        val positions = positions(samples); val total = positions.last(); val first = samples.first(); val last = samples.last()
        return samples.mapIndexed { i, sample ->
            val at = if (total != 0.0) positions[i] / total else i.toDouble() / samples.lastIndex
            sample.copy(x = first.x + (last.x - first.x) * at, y = first.y + (last.y - first.y) * at)
        }
    }
    private fun positions(samples: List<StrokeSample>): DoubleArray {
        val p = DoubleArray(samples.size)
        for (i in 1 until samples.size) p[i] = p[i - 1] + distance(samples[i - 1], samples[i])
        return p
    }
    private fun size(sample: StrokeSample, at: Double, total: Double, brush: StrokeBrush): Double {
        val pressure = sample.pressure.coerceIn(0.01, 1.0).pow(brush.pressureCurve)
        val start = if (brush.taperStart != 0.0 && total != 0.0) at / (total * brush.taperStart) else 1.0
        val end = if (brush.taperEnd != 0.0 && total != 0.0) (total - at) / (total * brush.taperEnd) else 1.0
        val taper = minOf(1.0, start, end)
        return max(0.2, brush.size * (if (brush.pressureSize) pressure else 1.0) * max(0.03, taper))
    }
    fun uniformRadii(samples: List<StrokeSample>, brush: StrokeBrush): DoubleArray {
        requireBudget(samples, brush)
        val positions = positions(samples); val total = positions.lastOrNull() ?: 0.0
        return DoubleArray(samples.size) { size(samples[it], positions[it], total, brush) / 2 }
    }
    fun dabs(samples: List<StrokeSample>, raw: StrokeBrush, seed: Int = 1): Sequence<StrokeDab> = sequence {
        val b = raw.normalized(); requireBudget(samples, b)
        if (samples.isEmpty()) return@sequence
        val positions = positions(samples); val total = positions.last()
        var randomState = if (seed == 0) 1 else seed
        fun random(): Double {
            randomState = randomState xor (randomState shl 13)
            randomState = randomState xor (randomState ushr 17)
            randomState = randomState xor (randomState shl 5)
            return (randomState.toLong() and 0xffffffffL).toDouble() / 4294967296.0
        }
        suspend fun SequenceScope<StrokeDab>.add(sample: StrokeSample, at: Double) {
            val pressure = sample.pressure.coerceIn(0.01, 1.0).pow(b.pressureCurve)
            val width = size(sample, at, total, b)
            val opacity = b.flow * (if (b.pressureOpacity) pressure else 1.0) * (if (b.pressureFlow) pressure else 1.0)
            if (b.kind == "spray") {
                repeat(max(1, ceil(width / 3).toInt())) {
                    val angle = random() * PI * 2; val radius = sqrt(random()) * width / 2
                    yield(StrokeDab(sample.x + cos(angle) * radius, sample.y + sin(angle) * radius, max(1.0, width / 24), opacity, b.angle, 1.0, random()))
                }
            } else yield(StrokeDab(sample.x, sample.y, width, opacity, b.angle, b.roundness, random()))
        }
        add(samples.first(), 0.0)
        var remaining = max(0.25, b.size * b.spacing)
        for (i in 1 until samples.size) {
            val start = samples[i - 1]; val end = samples[i]; val length = distance(start, end)
            var pos = remaining
            while (pos <= length) {
                val t = if (length != 0.0) pos / length else 0.0
                val p = end.copy(x = start.x + (end.x - start.x) * t, y = start.y + (end.y - start.y) * t, pressure = start.pressure + (end.pressure - start.pressure) * t)
                add(p, positions[i - 1] + pos)
                pos += max(0.25, b.size * b.spacing * if (b.pressureSize) max(0.1, p.pressure) else 1.0)
            }
            remaining = pos - length
        }
        if (samples.size > 1) add(samples.last(), total)
    }
}

/** Bounded recording keeps the accepted portion when the next sample is too expensive. */
class StrokeInput(first: StrokeSample, brush: StrokeBrush) {
    val brush = brush.normalized()
    private val recorded = mutableListOf(first)
    val samples: List<StrokeSample> get() = recorded.toList()
    internal val lastSample: StrokeSample get() = recorded.last()
    var limited = false
        private set
    private var length = 0.0
    init { StrokeGeometry.requireBudget(recorded, this.brush) }
    internal fun stopAtLimit() { limited = true }
    fun append(next: StrokeSample): Boolean {
        if (limited) return false
        val last = recorded.last(); val nextLength = length + hypot(next.x - last.x, next.y - last.y)
        if (recorded.size >= StrokeGeometry.MAX_SAMPLES || !next.finite() || StrokeGeometry.workForLength(nextLength, brush) > StrokeGeometry.MAX_WORK) {
            limited = true; return false
        }
        recorded.add(next); length = nextLength; return true
    }
}
