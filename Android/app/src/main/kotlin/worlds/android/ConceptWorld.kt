package worlds.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * A concept map as a small world (the same idea as the desktop's ConceptWorld.tsx):
 * concepts are points you move between, each link carries its phrase, one finger
 * moves around, two fingers zoom, dragging a concept places it, tapping one lights
 * up its neighbours. With [layered] the same map is drawn as a still diagram of
 * boxes in rows, for flowcharts that are steps rather than concepts.
 */
private class Body(val id: String, var x: Float, var y: Float) { var vx = 0f; var vy = 0f; var held = false; var depth = 0; var degree = 0 }

private val depthColors = listOf(Color(0xFF0A84FF), Color(0xFF47A467), Color(0xFFE0794A), Color(0xFFA26BD6), Color(0xFFD9A62E), Color(0xFF37B4B8), Color(0xFFDC5692))
private const val LINK = 170f

private fun depthsOf(graph: ConceptGraph): Map<String, Int> {
    val incoming = graph.nodes.associate { it.id to 0 }.toMutableMap()
    graph.edges.forEach { incoming[it.to] = (incoming[it.to] ?: 0) + 1 }
    val out = mutableMapOf<String, Int>()
    val queue = graph.nodes.filter { (incoming[it.id] ?: 0) == 0 }.map { it.id }.toMutableList()
    if (queue.isEmpty() && graph.nodes.isNotEmpty()) queue.add(graph.nodes[0].id)
    queue.forEach { out[it] = 0 }
    var i = 0
    while (i < queue.size) {
        val id = queue[i++]
        graph.edges.filter { it.from == id && it.to !in out }.forEach { out[it.to] = out.getValue(id) + 1; queue.add(it.to) }
    }
    graph.nodes.forEach { if (it.id !in out) out[it.id] = 0 }
    return out
}

@Composable
internal fun ConceptWorld(graph: ConceptGraph, layered: Boolean, modifier: Modifier = Modifier, fitSignal: Int = 0, description: String = "") {
    val measurer = rememberTextMeasurer()
    val depth = remember(graph) { depthsOf(graph) }
    val vertical = graph.direction in setOf("TD", "TB", "BT")
    // The bodies live as long as the map; a changed map keeps the concepts it already had where they are.
    val bodies = remember(graph, layered) {
        val perDepth = mutableMapOf<Int, Int>()
        val counts = graph.nodes.groupingBy { depth[it.id] ?: 0 }.eachCount()
        graph.nodes.associate { n ->
            val d = depth[n.id] ?: 0
            val slot = perDepth.getOrDefault(d, 0).also { perDepth[d] = it + 1 }
            val across = (slot - (counts.getValue(d) - 1) / 2f) * (if (layered) 220f else 150f)
            val stored = if (layered) null else graph.positions[n.id]
            val p = stored ?: if (vertical) MapPoint(across, d * (if (layered) 140f else LINK)) else MapPoint(d * (if (layered) 240f else LINK * 1.3f), across)
            n.id to Body(n.id, p.x, p.y).apply { this.depth = d; degree = graph.edges.count { it.from == n.id || it.to == n.id } }
        }
    }
    var alpha by remember(graph, layered) { mutableStateOf(if (layered || graph.nodes.all { it.id in graph.positions }) 0.0f else 1f) }
    var tick by remember { mutableStateOf(0) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    var camX by remember(graph, layered) { mutableStateOf(0f) }
    var camY by remember(graph, layered) { mutableStateOf(0f) }
    var zoom by remember(graph, layered) { mutableStateOf(1f) }
    var fitted by remember(graph, layered, fitSignal) { mutableStateOf(false) }
    var focus by remember(graph) { mutableStateOf<String?>(null) }
    val density = androidx.compose.ui.platform.LocalDensity.current.density

    fun radius(b: Body) = (7f + sqrt(b.degree.toFloat()) * 3.2f + if (b.depth == 0) 4f else 0f) * density
    fun fit() {
        if (bodies.isEmpty() || size.width == 0) return
        val xs = bodies.values.map { it.x }; val ys = bodies.values.map { it.y }
        val w = (xs.max() - xs.min() + 240f) * density; val h = (ys.max() - ys.min() + 180f) * density
        zoom = max(0.2f, min(1.6f, min(size.width / w, size.height / h)))
        camX = (xs.min() + xs.max()) / 2f; camY = (ys.min() + ys.max()) / 2f + 10f
    }
    fun step() {
        val list = bodies.values.toList()
        val a = alpha
        if (a < 0.003f) return
        for (i in list.indices) for (j in i + 1 until list.size) {
            val p = list[i]; val q = list[j]
            var dx = q.x - p.x; var dy = q.y - p.y
            var d2 = dx * dx + dy * dy
            if (d2 < 1f) { dx = 0.5f; dy = 0.3f; d2 = 1f }
            val d = sqrt(d2); val f = 26000f / d2 * a
            p.vx -= dx / d * f; p.vy -= dy / d * f; q.vx += dx / d * f; q.vy += dy / d * f
        }
        for (e in graph.edges) {
            val p = bodies[e.from] ?: continue; val q = bodies[e.to] ?: continue
            if (p === q) continue
            val dx = q.x - p.x; val dy = q.y - p.y; val d = max(1f, hypot(dx, dy)); val f = (d - LINK) * 0.05f * a
            p.vx += dx / d * f; p.vy += dy / d * f; q.vx -= dx / d * f; q.vy -= dy / d * f
        }
        val cx = list.map { it.x }.average().toFloat(); val cy = list.map { it.y }.average().toFloat()
        for (b in list) {
            if (b.held) { b.vx = 0f; b.vy = 0f; continue }
            b.vx = (b.vx - cx * 0.004f * a) * 0.55f; b.vy = (b.vy - cy * 0.004f * a) * 0.55f
            b.x += b.vx.coerceIn(-40f, 40f); b.y += b.vy.coerceIn(-40f, 40f)
        }
        alpha = a * 0.975f
    }

    LaunchedEffect(graph, layered, size, fitSignal) {
        if (size.width == 0) return@LaunchedEffect
        if (!fitted) { repeat(120) { if (alpha > 0.05f) step() }; fit(); fitted = true; tick++ }
        // Frames only while the world is moving; a still map costs nothing.
        while (isActive) {
            if (alpha >= 0.003f || bodies.values.any { it.held }) { withFrameNanos { }; step(); tick++ } else delay(120)
        }
    }

    val ink = MaterialTheme.colorScheme.onSurface
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val paper = MaterialTheme.colorScheme.surface
    val accent = MaterialTheme.colorScheme.primary

    fun toScreen(x: Float, y: Float) = Offset((x - camX) * zoom * density + size.width / 2f, (y - camY) * zoom * density + size.height / 2f)
    fun hit(at: Offset): Body? = bodies.values.minByOrNull { val s = toScreen(it.x, it.y); hypot(s.x - at.x, s.y - at.y) }?.takeIf {
        val s = toScreen(it.x, it.y); hypot(s.x - at.x, s.y - at.y) <= max(22f * density, radius(it) * zoom + 8f * density)
    }

    Box(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(paper)
            .onSizeChanged { size = it }
            .semantics { contentDescription = description }
            .pointerInput(graph, layered) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    val grabbed = hit(down.position)
                    var moved = false
                    grabbed?.held = !layered
                    while (true) {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.filter { it.pressed }
                        if (pressed.isEmpty()) break
                        if (pressed.size >= 2) {
                            grabbed?.held = false
                            val z = event.calculateZoom(); val c = event.calculateCentroid(); val pan = event.calculatePan()
                            if (c != Offset.Unspecified) {
                                val wx = (c.x - size.width / 2f) / (zoom * density) + camX; val wy = (c.y - size.height / 2f) / (zoom * density) + camY
                                zoom = (zoom * z).coerceIn(0.15f, 3f)
                                camX = wx - (c.x - size.width / 2f) / (zoom * density) - pan.x / (zoom * density)
                                camY = wy - (c.y - size.height / 2f) / (zoom * density) - pan.y / (zoom * density)
                            }
                            moved = true
                        } else {
                            val change = pressed[0]; val delta = change.positionChange()
                            if (delta != Offset.Zero) moved = moved || hypot(delta.x, delta.y) > 1f
                            if (grabbed != null && !layered) {
                                grabbed.x += delta.x / (zoom * density); grabbed.y += delta.y / (zoom * density)
                                alpha = max(alpha, 0.3f)
                            } else { camX -= delta.x / (zoom * density); camY -= delta.y / (zoom * density) }
                        }
                        event.changes.forEach { it.consume() }
                        tick++
                    }
                    grabbed?.held = false
                    if (!moved) focus = grabbed?.id?.takeIf { it != focus }
                    tick++
                }
            }
    ) {
        Canvas(Modifier.fillMaxSize()) {
            tick.let { }
            val near = mutableSetOf<String>()
            focus?.let { f -> near.add(f); graph.edges.forEach { if (it.from == f) near.add(it.to); if (it.to == f) near.add(it.from) } }
            // A faint grid of dots that moves with the world.
            val gap = 32f * zoom * density
            if (!layered && gap > 9f) {
                val o = toScreen(0f, 0f)
                var x = ((o.x % gap) + gap) % gap
                while (x < this.size.width) {
                    var y = ((o.y % gap) + gap) % gap
                    while (y < this.size.height) { drawCircle(muted.copy(alpha = 0.18f), 1.1f, Offset(x, y)); y += gap }
                    x += gap
                }
            }
            val boxW = 150f * zoom * density; val boxH = 44f * zoom * density
            graph.edges.forEach { e ->
                val p = bodies[e.from] ?: return@forEach; val q = bodies[e.to] ?: return@forEach
                val a = toScreen(p.x, p.y); val b = toScreen(q.x, q.y)
                val dx = b.x - a.x; val dy = b.y - a.y; val d = max(1f, hypot(dx, dy))
                val ra = if (layered) min(boxW / 2f / max(0.01f, kotlin.math.abs(dx / d)), boxH / 2f / max(0.01f, kotlin.math.abs(dy / d))) else radius(p) * zoom + 2f
                val rb = if (layered) min(boxW / 2f / max(0.01f, kotlin.math.abs(dx / d)), boxH / 2f / max(0.01f, kotlin.math.abs(dy / d))) + 3f else radius(q) * zoom + 3f
                val s = Offset(a.x + dx / d * ra, a.y + dy / d * ra); val t = Offset(b.x - dx / d * rb, b.y - dy / d * rb)
                val on = focus != null && (e.from == focus || e.to == focus)
                val dim = focus != null && !on
                val color = (if (on) accent else muted).copy(alpha = if (dim) 0.18f else if (on) 0.95f else 0.6f)
                drawLine(color, s, t, strokeWidth = (if (e.style == "thick") 2.6f else 1.4f) * density, pathEffect = if (e.style == "dotted") PathEffect.dashPathEffect(floatArrayOf(10f, 10f)) else null)
                if (e.style != "line") {
                    val ang = atan2(dy, dx); val k = 7f * density
                    drawPath(Path().apply { moveTo(t.x, t.y); lineTo(t.x - k * cos(ang - 0.42f), t.y - k * sin(ang - 0.42f)); lineTo(t.x - k * cos(ang + 0.42f), t.y - k * sin(ang + 0.42f)); close() }, color)
                }
                if (e.label.isNotBlank() && (zoom >= 0.5f || on)) {
                    val layout = measurer.measure(e.label, TextStyle(fontSize = 11.sp, color = if (on) ink else muted, fontWeight = FontWeight.Medium))
                    val mid = Offset((s.x + t.x) / 2f, (s.y + t.y) / 2f)
                    val pw = layout.size.width + 14f * density; val ph = layout.size.height + 6f * density
                    drawRoundRect(paper.copy(alpha = if (dim) 0.4f else 0.96f), Offset(mid.x - pw / 2f, mid.y - ph / 2f), Size(pw, ph), CornerRadius(ph / 2f))
                    drawRoundRect(color.copy(alpha = if (dim) 0.12f else 0.4f), Offset(mid.x - pw / 2f, mid.y - ph / 2f), Size(pw, ph), CornerRadius(ph / 2f), style = Stroke(1f * density))
                    drawText(layout, topLeft = Offset(mid.x - layout.size.width / 2f, mid.y - layout.size.height / 2f), alpha = if (dim) 0.35f else 1f)
                }
            }
            graph.nodes.forEach { n ->
                val b = bodies[n.id] ?: return@forEach
                val c = toScreen(b.x, b.y)
                val dim = focus != null && n.id !in near
                val color = depthColors[b.depth % depthColors.size]
                if (layered) {
                    drawRoundRect(color.copy(alpha = if (dim) 0.08f else 0.18f), Offset(c.x - boxW / 2f, c.y - boxH / 2f), Size(boxW, boxH), CornerRadius(10f * density))
                    drawRoundRect(color.copy(alpha = if (dim) 0.2f else 0.7f), Offset(c.x - boxW / 2f, c.y - boxH / 2f), Size(boxW, boxH), CornerRadius(10f * density), style = Stroke(1.2f * density))
                    val layout = measurer.measure(n.label, TextStyle(fontSize = (13f * zoom).coerceIn(9f, 16f).sp, color = ink, fontWeight = FontWeight.Medium), maxLines = 2, constraints = androidx.compose.ui.unit.Constraints(maxWidth = max(1, (boxW - 12f * density).toInt())))
                    drawText(layout, topLeft = Offset(c.x - layout.size.width / 2f, c.y - layout.size.height / 2f), alpha = if (dim) 0.4f else 1f)
                } else {
                    val r = radius(b) * zoom
                    if (n.id == focus) drawCircle(color.copy(alpha = 0.22f), r + 7f * density, c)
                    drawCircle(color.copy(alpha = if (dim) 0.25f else 1f), r, c)
                    if (zoom >= 0.35f || n.id in near) {
                        val layout = measurer.measure(n.label, TextStyle(fontSize = (if (b.depth == 0) 14.5f else 13f).sp, color = if (dim) muted else ink, fontWeight = if (b.depth == 0) FontWeight.SemiBold else FontWeight.Medium))
                        drawText(layout, topLeft = Offset(c.x - layout.size.width / 2f, c.y + r + 5f * density), alpha = if (dim) 0.45f else 1f)
                    }
                }
            }
        }
    }
}

@Composable
internal fun ConceptWorldFrame(graph: ConceptGraph, layered: Boolean, fitSignal: Int, description: String) =
    ConceptWorld(graph, layered, Modifier.fillMaxWidth().height(380.dp), fitSignal, description)
