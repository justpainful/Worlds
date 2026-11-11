package worlds.android.glass

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.addOutline
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

/**
 * Worlds glass for Android, matching the material on Windows and Apple.
 *
 * Glass is reserved for floating chrome. It reads the live content behind it from a
 * [GlassBackdrop], blurs it, lifts its colour and bends it at the edge. There is one
 * light from the upper left and exactly one uneven rim; nested selections have no edge.
 * Android below 12, or glass quality Disabled, draw the same geometry with a solid fill.
 */
@Stable
class GlassBackdrop internal constructor(internal val layer: GraphicsLayer) {
    internal var origin by mutableStateOf(Offset.Zero)
}

@Composable
fun rememberGlassBackdrop(): GlassBackdrop {
    val layer = rememberGraphicsLayer()
    return remember(layer) { GlassBackdrop(layer) }
}

val LocalGlassBackdrop = compositionLocalOf<GlassBackdrop?> { null }

/** "specular", "standard" or "disabled", from the Appearance settings. */
val LocalGlassQuality = compositionLocalOf { "standard" }
val LocalGlassDark = compositionLocalOf { true }

/** Marks the content that glass above it should see. */
fun Modifier.glassBackdropSource(backdrop: GlassBackdrop): Modifier = this
    .onGloballyPositioned { backdrop.origin = it.positionInWindow() }
    .drawWithContent {
        backdrop.layer.record { this@drawWithContent.drawContent() }
        drawLayer(backdrop.layer)
    }

enum class GlassKind { Bar, Menu }

private const val LENS_SHADER = """
uniform shader content;
uniform float2 glassSize;
uniform float2 glassOrigin;
uniform float radius;
uniform float bend;
uniform float band;
float box(float2 p, float2 b, float r) {
    float2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
half4 main(float2 c) {
    float2 h = glassSize * 0.5;
    float2 p = c - glassOrigin - h;
    float d = box(p, h, radius);
    float t = clamp(1.0 + d / band, 0.0, 1.0);
    float2 n = float2(box(p + float2(1.0, 0.0), h, radius) - box(p - float2(1.0, 0.0), h, radius),
                      box(p + float2(0.0, 1.0), h, radius) - box(p - float2(0.0, 1.0), h, radius));
    float l = max(length(n), 0.0001);
    return content.eval(c - (n / l) * bend * t * t);
}
"""

@RequiresApi(31)
private fun glassEffect(blurPx: Float, saturation: Float, size: IntSize, pad: Float, radius: Float, bend: Float, band: Float): RenderEffect {
    val blur = RenderEffect.createBlurEffect(blurPx, blurPx, Shader.TileMode.CLAMP)
    val vivid = RenderEffect.createColorFilterEffect(ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(saturation) }), blur)
    if (Build.VERSION.SDK_INT < 33 || bend <= 0f) return vivid
    return lensEffect(vivid, size, pad, radius, bend, band)
}

@RequiresApi(33)
private fun lensEffect(inner: RenderEffect, size: IntSize, pad: Float, radius: Float, bend: Float, band: Float): RenderEffect {
    val shader = RuntimeShader(LENS_SHADER)
    shader.setFloatUniform("glassSize", size.width.toFloat(), size.height.toFloat())
    shader.setFloatUniform("glassOrigin", pad, pad)
    shader.setFloatUniform("radius", radius)
    shader.setFloatUniform("bend", bend)
    shader.setFloatUniform("band", band)
    return RenderEffect.createChainEffect(RenderEffect.createRuntimeShaderEffect(shader, "content"), inner)
}

private class GlassPosition { var value by mutableStateOf(Offset.Zero) }

/** Draws a piece of glass behind this element's content. */
@Composable
fun Modifier.worldsGlass(shape: Shape, kind: GlassKind = GlassKind.Bar): Modifier {
    val backdrop = LocalGlassBackdrop.current
    val quality = LocalGlassQuality.current
    val dark = LocalGlassDark.current
    val blurLayer = rememberGraphicsLayer()
    val position = remember { GlassPosition() }
    val live = backdrop != null && quality != "disabled" && Build.VERSION.SDK_INT >= 31
    val specular = quality == "specular"
    return this
        .onGloballyPositioned { position.value = it.positionInWindow() }
        .drawWithCache {
            val outline = shape.createOutline(size, layoutDirection, this)
            val path = Path().apply { addOutline(outline) }
            val radius = (outline as? Outline.Rounded)?.roundRect?.topLeftCornerRadius?.x ?: 0f
            val pad = 28.dp.toPx()
            val layerSize = IntSize((size.width + pad * 2).toInt().coerceAtLeast(1), (size.height + pad * 2).toInt().coerceAtLeast(1))
            if (live && size.width > 0f && size.height > 0f) {
                val blurPx = (if (kind == GlassKind.Menu) 22.dp else 13.dp).toPx()
                val bend = (if (specular) 11.dp else 8.dp).toPx()
                blurLayer.renderEffect = glassEffect(blurPx, if (dark) 1.25f else 1.2f, IntSize(size.width.toInt(), size.height.toInt()), pad, radius, bend, 15.dp.toPx()).asComposeRenderEffect()
            }
            // Milky body: glass brightens what is behind it rather than darkening it.
            val body = when {
                !live -> if (dark) Color(0xFF242428) else Color(0xFFFBFBFA)
                kind == GlassKind.Menu -> if (dark) Color(0xB82A2A2F) else Color(0xCCFBFBFA)
                dark -> Color(0x9E26262B)
                else -> Color(0x8CFFFFFF)
            }
            val sheen = Brush.linearGradient(
                0f to Color.White.copy(alpha = if (dark) 0.10f else 0.34f),
                0.45f to Color.White.copy(alpha = if (dark) 0.02f else 0.06f),
                1f to Color.White.copy(alpha = if (dark) 0.05f else 0.14f),
                start = Offset.Zero, end = Offset(size.width, size.height),
            )
            // One rim, bright upper left, fading, a soft return at lower right.
            val rim = Brush.linearGradient(
                0f to Color.White.copy(alpha = if (dark) 0.42f else 0.95f),
                0.34f to Color.White.copy(alpha = if (dark) 0.10f else 0.40f),
                0.68f to Color.White.copy(alpha = if (dark) 0.05f else 0.22f),
                1f to Color.White.copy(alpha = if (dark) 0.22f else 0.70f),
                start = Offset.Zero, end = Offset(size.width, size.height),
            )
            val rimWidth = 1.dp.toPx()
            val shadowRadius = 22.dp.toPx()
            val shadowY = 8.dp.toPx()
            val shadowColor = Color.Black.copy(alpha = if (dark) 0.46f else 0.16f).toArgb()
            onDrawWithContent {
                if (Build.VERSION.SDK_INT >= 28) {
                    // The shadow stays outside the shape so it never shows through the glass.
                    clipPath(path, clipOp = ClipOp.Difference) {
                        drawIntoCanvas { canvas ->
                            val paint = Paint().apply { color = Color.Black }
                            paint.asFrameworkPaint().setShadowLayer(shadowRadius, 0f, shadowY, shadowColor)
                            canvas.drawPath(path, paint)
                        }
                    }
                }
                if (live && backdrop != null) {
                    val shift = position.value - backdrop.origin
                    blurLayer.record(layerSize) {
                        translate(pad - shift.x, pad - shift.y) { drawLayer(backdrop.layer) }
                    }
                    clipPath(path) { translate(-pad, -pad) { drawLayer(blurLayer) } }
                }
                drawPath(path, body)
                drawPath(path, sheen)
                drawPath(path, rim, style = Stroke(rimWidth), blendMode = BlendMode.SrcOver)
                drawContent()
            }
        }
}

/** The selected item inside a piece of glass: a lighter pool with no edge. */
@Composable
fun Modifier.worldsGlassLens(shape: Shape): Modifier {
    val dark = LocalGlassDark.current
    return this.drawWithCache {
        val path = Path().apply { addOutline(shape.createOutline(size, layoutDirection, this@drawWithCache)) }
        // Nearly opaque, so the selected label stays readable whatever scrolls behind the glass.
        val fill = Brush.verticalGradient(
            0f to if (dark) Color(0xF2404046) else Color(0xF5FFFFFF),
            1f to if (dark) Color(0xF2393940) else Color(0xF0FBFBFA),
        )
        onDrawWithContent { drawPath(path, fill); drawContent() }
    }
}

