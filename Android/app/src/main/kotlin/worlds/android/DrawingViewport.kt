package worlds.android

import kotlin.math.min

/** Transient view state, independent of saved drawing coordinates. */
internal data class DrawingViewport(val centerX: Double = 640.0, val centerY: Double = 360.0, val zoom: Double = 1.0) {
    data class Transform(val scale: Double, val left: Double, val top: Double) {
        fun sceneX(x: Double) = (x - left) / scale
        fun sceneY(y: Double) = (y - top) / scale
    }
    fun transform(width: Int, height: Int): Transform {
        val w = width.coerceAtLeast(1).toDouble(); val h = height.coerceAtLeast(1).toDouble()
        val fit = min(w / 1280.0, h / 720.0).coerceAtLeast(0.000001)
        val scale = fit * zoom
        return Transform(scale, w / 2 - centerX * scale, h / 2 - centerY * scale)
    }
    fun zoomAround(width: Int, height: Int, previousX: Double, previousY: Double, nextX: Double, nextY: Double, ratio: Double): DrawingViewport {
        if (!listOf(previousX, previousY, nextX, nextY, ratio).all { it.isFinite() } || ratio <= 0) return this
        val old = transform(width, height)
        val newZoom = (zoom * ratio).coerceIn(0.5, 16.0)
        val nextScale = old.scale * newZoom / zoom
        val worldX = old.sceneX(previousX); val worldY = old.sceneY(previousY)
        val cx = (worldX - (nextX - width.coerceAtLeast(1) / 2.0) / nextScale).coerceIn(-1e7, 1e7)
        val cy = (worldY - (nextY - height.coerceAtLeast(1) / 2.0) / nextScale).coerceIn(-1e7, 1e7)
        return if (cx.isFinite() && cy.isFinite()) DrawingViewport(cx, cy, newZoom) else this
    }
    fun zoomCentered(factor: Double): DrawingViewport =
        if (factor.isFinite() && factor > 0) copy(zoom = (zoom * factor).coerceIn(0.5, 16.0)) else this
}
