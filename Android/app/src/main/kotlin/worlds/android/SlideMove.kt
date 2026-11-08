package worlds.android

import kotlin.math.cos
import kotlin.math.sin

internal data class SlideMoveTarget(val id: String, val x: Double, val y: Double, val width: Double, val height: Double, val rotation: Double)
internal data class SlideHandle(val name: String, val x: Double, val y: Double)

internal fun slideHandles(target: SlideMoveTarget): List<SlideHandle> {
    val angle = Math.toRadians(target.rotation); val c = cos(angle); val s = sin(angle)
    val centerX = target.x + target.width / 2; val centerY = target.y + target.height / 2
    return listOf("nw" to (-1 to -1), "n" to (0 to -1), "ne" to (1 to -1), "e" to (1 to 0),
        "se" to (1 to 1), "s" to (0 to 1), "sw" to (-1 to 1), "w" to (-1 to 0)).map { (name, direction) ->
        val x = direction.first * target.width / 2; val y = direction.second * target.height / 2
        SlideHandle(name, centerX + x * c - y * s, centerY + x * s + y * c)
    }
}

internal fun slideResize(target: SlideMoveTarget, handle: String, dx: Double, dy: Double): SlideMoveTarget {
    require(handle in setOf("nw", "n", "ne", "e", "se", "s", "sw", "w"))
    val angle = Math.toRadians(target.rotation); val c = cos(angle); val s = sin(angle)
    val localX = dx * c + dy * s; val localY = -dx * s + dy * c
    val horizontal = if ('e' in handle) 1 else if ('w' in handle) -1 else 0
    val vertical = if ('s' in handle) 1 else if ('n' in handle) -1 else 0
    val width = if (horizontal == 0) target.width else (target.width + horizontal * localX).coerceIn(16.0, 2560.0)
    val height = if (vertical == 0) target.height else (target.height + vertical * localY).coerceIn(16.0, 1440.0)
    val shiftX = horizontal * (width - target.width) / 2; val shiftY = vertical * (height - target.height) / 2
    val centerX = target.x + target.width / 2 + shiftX * c - shiftY * s
    val centerY = target.y + target.height / 2 + shiftX * s + shiftY * c
    return target.copy(x = centerX - width / 2, y = centerY - height / 2, width = width, height = height)
}

/** Elements are stored back to front; hit testing reverses that order. */
internal fun slideMoveHit(targets: List<SlideMoveTarget>, x: Double, y: Double): SlideMoveTarget? {
    val duplicateIds = targets.groupingBy { it.id }.eachCount().filterValues { it > 1 }.keys
    return targets.asReversed().firstOrNull { target ->
        if (target.id.isBlank() || target.id in duplicateIds || !listOf(target.x, target.y, target.width, target.height, target.rotation).all { it.isFinite() } || target.width <= 0 || target.height <= 0) false
        else {
            val angle = Math.toRadians(-target.rotation)
            val dx = x - (target.x + target.width / 2); val dy = y - (target.y + target.height / 2)
            val localX = dx * cos(angle) - dy * sin(angle); val localY = dx * sin(angle) + dy * cos(angle)
            kotlin.math.abs(localX) <= target.width / 2 && kotlin.math.abs(localY) <= target.height / 2
        }
    }
}
