package worlds.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.floor
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import org.json.JSONObject
import worlds.stylus.StrokeBrush
import worlds.stylus.StrokeGeometry
import worlds.stylus.StrokeSample
import java.io.ByteArrayOutputStream

internal data class InkStroke(val samples: List<StrokeSample>, val brush: StrokeBrush, val erase: Boolean, val color: Int = Color.rgb(32, 32, 35), val id: String = "")

/** Rendering for the stroke-only local format. Unknown features fail closed. */
internal object DrawingInk {
    const val WIDTH = 1280
    const val HEIGHT = 720

    fun parse(document: String): List<InkStroke> {
        val scene = JSONObject(document).getJSONObject("scene")
        require(scene.getInt("schema") == 1)
        val frames = scene.getJSONObject("frames"); val frameId = scene.getString("defaultFrameId")
        val frame = frames.getJSONObject(frameId)
        require(frames.length() == 1 && frame.getInt("w") == WIDTH && frame.getInt("h") == HEIGHT && frame.getDouble("x") == 0.0 && frame.getDouble("y") == 0.0 && frame.getString("background") == "#ffffff" && frame.getBoolean("clip"))
        require(scene.getJSONObject("layers").length() == 1 && scene.getJSONArray("layerOrder").length() == 1)
        val layerId = scene.getJSONArray("layerOrder").getString(0); val layer = scene.getJSONObject("layers").getJSONObject(layerId)
        require(layer.getBoolean("visible") && layer.getDouble("opacity") == 1.0 && layer.getString("blend") == "source-over" && layer.isNull("parentId"))
        require(scene.getJSONObject("assets").length() == 0 && scene.getJSONObject("masks").length() == 0 && scene.getJSONObject("steps").length() == 0)
        val nodes = scene.getJSONObject("nodes"); val order = scene.getJSONArray("nodeOrder")
        require(order.length() == nodes.length())
        val seen = mutableSetOf<String>()
        return (0 until order.length()).map { index ->
            val id = order.getString(index); require(seen.add(id))
            val node = nodes.getJSONObject(id)
            require(node.getString("id") == id && node.getString("kind") == "stroke" && node.getString("layerId") == layerId && node.getString("frameId") == frameId)
            require(node.getBoolean("visible") && node.getDouble("rotation") == 0.0 && node.getDouble("opacity") == 1.0 && !node.getBoolean("flipX") && !node.getBoolean("flipY"))
            require(!node.has("geometrySize") && !node.has("maskId") && !node.optBoolean("alphaLock") && node.getJSONArray("effects").length() == 0)
            val style = node.getJSONObject("brush")
            val color = style.getString("color")
            require(Regex("#[0-9a-fA-F]{6}").matches(color))
            val kind = style.getString("kind")
            require(kind in setOf("hard", "marker", "highlighter", "natural-pencil") && !style.has("tipAssetId"))
            val hardness = style.getDouble("hardness"); require(hardness in 0.0..1.0)
            val brush = StrokeBrush(kind = kind, size = style.getDouble("size"), spacing = style.getDouble("spacing"),
                flow = style.getDouble("flow"), angle = style.getDouble("angle"), roundness = style.getDouble("roundness"),
                smoothing = style.getDouble("smoothing"), stabilizer = style.getDouble("stabilizer"),
                pressureSize = style.getBoolean("pressureSize"), pressureOpacity = style.getBoolean("pressureOpacity"),
                pressureFlow = style.getBoolean("pressureFlow"), pressureCurve = style.getDouble("pressureCurve"),
                opacity = style.getDouble("opacity"), straightLine = style.optBoolean("straightLine"),
                taperStart = style.getDouble("taperStart"), taperEnd = style.getDouble("taperEnd"))
            if (kind == "hard") require(brush.opacity == 1.0 && brush.flow == 1.0 && hardness == 1.0 && brush.roundness == 1.0 &&
                !brush.pressureOpacity && !brush.pressureFlow && !brush.straightLine)
            require(brush == brush.normalized())
            val points = node.getJSONArray("samples"); require(points.length() > 0)
            val x = node.getDouble("x"); val y = node.getDouble("y"); require(x.isFinite() && y.isFinite())
            val samples = (0 until points.length()).map { pointIndex ->
                val p = points.getJSONObject(pointIndex)
                StrokeSample(p.getDouble("x") + x, p.getDouble("y") + y, p.getDouble("pressure"), p.getDouble("tiltX"), p.getDouble("tiltY"), p.getDouble("time"))
            }
            StrokeGeometry.requireBudget(samples, brush)
            InkStroke(samples, brush, node.optBoolean("erase"), Color.parseColor(color), id)
        }
    }

    fun draw(canvas: Canvas, strokes: List<InkStroke>) {
        canvas.drawColor(Color.WHITE)
        val layer = canvas.saveLayer(0f, 0f, WIDTH.toFloat(), HEIGHT.toFloat(), null)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(32, 32, 35); style = Paint.Style.FILL }
        strokes.forEach { stroke ->
            if (stroke.brush.kind == "natural-pencil") {
                drawPencil(canvas, stroke)
            } else if (stroke.brush.kind == "marker" || stroke.brush.kind == "highlighter") {
                drawUniform(canvas, stroke)
            } else {
                paint.color = stroke.color
                paint.xfermode = if (stroke.erase) PorterDuffXfermode(PorterDuff.Mode.CLEAR) else null
                StrokeGeometry.dabs(stroke.samples, stroke.brush).forEach { canvas.drawCircle(it.x.toFloat(), it.y.toFloat(), (it.size / 2).toFloat(), paint) }
            }
        }
        paint.xfermode = null
        canvas.restoreToCount(layer)
    }

    /** Seeded pigment follows the desktop natural-pencil dab model. */
    private fun drawPencil(canvas: Canvas, stroke: InkStroke) {
        val composite = Paint().apply {
            alpha = (stroke.brush.opacity * 255).roundToInt().coerceIn(0, 255)
            if (stroke.erase) xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT)
        }
        val layer = canvas.saveLayer(0f, 0f, WIDTH.toFloat(), HEIGHT.toFloat(), composite)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = stroke.color; style = Paint.Style.FILL }
        fun subpixel(n: Double): Float = (floor(n * 256.0 + 0.5) / 256.0).toFloat()
        StrokeGeometry.dabs(stroke.samples, stroke.brush).forEach { dab ->
            var state = (dab.noise * 4294967296.0).toLong().toInt().let { if (it == 0) 1 else it }
            fun random(): Double { state = state xor (state shl 13); state = state xor (state ushr 17); state = state xor (state shl 5); return (state.toLong() and 0xffffffffL).toDouble() / 4294967296.0 }
            val save = canvas.save()
            canvas.translate(subpixel(dab.x), subpixel(dab.y)); canvas.rotate(dab.angle.toFloat()); canvas.scale(1f, dab.roundness.toFloat())
            repeat(min(256, max(5, ceil(dab.size * 4).toInt()))) {
                val angle = random() * PI * 2; val radius = sqrt(random()) * dab.size / 2
                paint.alpha = (dab.opacity * (0.15 + random() * 0.85) * 255).roundToInt().coerceIn(0, 255)
                val grain = max(0.3, dab.size * 0.065 * random())
                canvas.drawCircle(subpixel(cos(angle) * radius), subpixel(sin(angle) * radius), subpixel(grain), paint)
            }
            canvas.restoreToCount(save)
        }
        canvas.restoreToCount(layer)
    }

    /** Matches the desktop continuous marker geometry and composites each stroke once. */
    private fun drawUniform(canvas: Canvas, stroke: InkStroke) {
        val brush = stroke.brush
        val samples = StrokeGeometry.straight(stroke.samples, brush.straightLine)
        if (samples.isEmpty()) return
        val radii = StrokeGeometry.uniformRadii(samples, brush)
        val path = Path()
        val marker = brush.kind == "marker"
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = stroke.color; style = Paint.Style.FILL }
        if (samples.size == 1) {
            val p = samples[0]; val r = radii[0].toFloat()
            if (marker) path.addCircle(p.x.toFloat(), p.y.toFloat(), r, Path.Direction.CW)
            else path.addRect(p.x.toFloat() - r, p.y.toFloat() - r, p.x.toFloat() + r, p.y.toFloat() + r, Path.Direction.CW)
        } else if (!brush.pressureSize && brush.taperStart == 0.0 && brush.taperEnd == 0.0) {
            path.moveTo(samples[0].x.toFloat(), samples[0].y.toFloat())
            samples.drop(1).forEach { path.lineTo(it.x.toFloat(), it.y.toFloat()) }
            paint.style = Paint.Style.STROKE; paint.strokeWidth = brush.size.toFloat()
            paint.strokeJoin = Paint.Join.ROUND; paint.strokeCap = if (marker) Paint.Cap.ROUND else Paint.Cap.BUTT
        } else {
            var segments = 0
            for (i in 1 until samples.size) {
                val p = samples[i - 1]; val q = samples[i]
                val dx = q.x - p.x; val dy = q.y - p.y; val length = hypot(dx, dy)
                if (length == 0.0) continue
                segments++
                val nx = -dy / length; val ny = dx / length; val a = radii[i - 1]; val z = radii[i]
                path.moveTo((p.x + nx * a).toFloat(), (p.y + ny * a).toFloat())
                path.lineTo((p.x - nx * a).toFloat(), (p.y - ny * a).toFloat())
                path.lineTo((q.x - nx * z).toFloat(), (q.y - ny * z).toFloat())
                path.lineTo((q.x + nx * z).toFloat(), (q.y + ny * z).toFloat()); path.close()
            }
            for (i in samples.indices) if (marker || i > 0 && i < samples.lastIndex) {
                path.addCircle(samples[i].x.toFloat(), samples[i].y.toFloat(), radii[i].toFloat(), Path.Direction.CW)
            }
            if (segments == 0 && !marker) {
                val p = samples[0]; val r = (radii.maxOrNull() ?: 0.1).toFloat()
                path.addRect(p.x.toFloat() - r, p.y.toFloat() - r, p.x.toFloat() + r, p.y.toFloat() + r, Path.Direction.CW)
            }
        }
        val composite = Paint().apply {
            alpha = (brush.opacity * brush.flow * 255).roundToInt().coerceIn(0, 255)
            if (stroke.erase) xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT)
        }
        val layer = canvas.saveLayer(0f, 0f, WIDTH.toFloat(), HEIGHT.toFloat(), composite)
        canvas.drawPath(path, paint)
        canvas.restoreToCount(layer)
    }

    fun png(document: String): ByteArray {
        val strokes = parse(document)
        val bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
        try {
            draw(Canvas(bitmap), strokes)
            return ByteArrayOutputStream().use { output ->
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) { "PNG encoding failed" }
                output.toByteArray()
            }
        } finally { bitmap.recycle() }
    }
}
