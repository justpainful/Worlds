package worlds.android.glass

import android.app.Activity
import android.content.Context
import android.os.Build
import android.view.View
import android.view.Window
import android.view.WindowManager
import androidx.annotation.RequiresApi
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * WorldsGlass Design System:
 * Glassmorphic, frosted translucent surfaces with specular highlights,
 * hardware blur on API 31+ (Android 12+ and ChromeOS), and high-contrast
 * tint fallbacks on older Android versions.
 */

data class GlassStyle(
    val backgroundColor: Color,
    val borderColor: Color,
    val specularHighlight: Brush,
    val blurRadiusDp: Dp = 24.dp,
    val cornerRadius: Dp = 16.dp,
    val elevation: Dp = 2.dp
)

object WorldsGlassDefaults {
    @Composable
    fun standard(
        isDark: Boolean = androidx.compose.foundation.isSystemInDarkTheme(),
        accent: Color = MaterialTheme.colorScheme.primary
    ): GlassStyle {
        val bg = if (isDark) Color(0xCC1A1A20) else Color(0xD8F8F9FB)
        val border = if (isDark) Color(0x33FFFFFF) else Color(0x33000000)
        val sheen = Brush.verticalGradient(
            colors = if (isDark) {
                listOf(Color(0x22FFFFFF), Color(0x05FFFFFF), Color(0x00000000))
            } else {
                listOf(Color(0x66FFFFFF), Color(0x1AFFFFFF), Color(0x00FFFFFF))
            }
        )
        return GlassStyle(
            backgroundColor = bg,
            borderColor = border,
            specularHighlight = sheen,
            blurRadiusDp = 24.dp,
            cornerRadius = 16.dp,
            elevation = 3.dp
        )
    }

    @Composable
    fun specular(
        isDark: Boolean = androidx.compose.foundation.isSystemInDarkTheme()
    ): GlassStyle {
        val base = standard(isDark)
        val sheen = Brush.linearGradient(
            colors = listOf(
                Color(0x38FFFFFF),
                Color(0x0AFFFFFF),
                Color(0x18FFFFFF)
            )
        )
        return base.copy(
            specularHighlight = sheen,
            elevation = 6.dp,
            borderColor = if (isDark) Color(0x4DFFFFFF) else Color(0x40000000)
        )
    }
}

/**
 * Base glass surface container with specular border and layered gradient.
 */
@Composable
fun WorldsGlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(16.dp),
    style: GlassStyle = WorldsGlassDefaults.standard(),
    content: @Composable BoxScope.() -> Unit
) {
    Box(
        modifier = modifier
            .clip(shape)
            .background(style.backgroundColor)
            .background(style.specularHighlight)
            .border(BorderStroke(1.dp, style.borderColor), shape)
    ) {
        content()
    }
}

/**
 * Reusable glass panel for cards, sidebars, and adaptive multi-pane panels.
 */
@Composable
fun WorldsGlassPanel(
    modifier: Modifier = Modifier,
    title: String? = null,
    actions: @Composable (RowScope.() -> Unit)? = null,
    shape: Shape = RoundedCornerShape(18.dp),
    style: GlassStyle = WorldsGlassDefaults.standard(),
    content: @Composable ColumnScope.() -> Unit
) {
    WorldsGlassSurface(modifier = modifier, shape = shape, style = style) {
        Column(Modifier.padding(18.dp)) {
            if (title != null || actions != null) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (title != null) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    } else Spacer(Modifier.width(1.dp))
                    actions?.let { actionsScope ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            actionsScope()
                        }
                    }
                }
            }
            content()
        }
    }
}

/**
 * Floating glass toolbar with adaptive docked or floating layout.
 */
@Composable
fun WorldsGlassToolbar(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(24.dp),
    style: GlassStyle = WorldsGlassDefaults.specular(),
    content: @Composable RowScope.() -> Unit
) {
    WorldsGlassSurface(
        modifier = modifier.heightIn(min = 48.dp),
        shape = shape,
        style = style
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            content = content
        )
    }
}

/**
 * Glass navigation wrapper for navigation rail, bottom bar, or drawer.
 */
@Composable
fun WorldsGlassNavigation(
    modifier: Modifier = Modifier,
    vertical: Boolean = false,
    content: @Composable () -> Unit
) {
    val shape = if (vertical) RoundedCornerShape(topEnd = 24.dp, bottomEnd = 24.dp) else RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    WorldsGlassSurface(
        modifier = modifier,
        shape = shape,
        style = WorldsGlassDefaults.standard()
    ) {
        content()
    }
}

/**
 * Touch-optimized glass button with ripple and hover state.
 */
@Composable
fun WorldsGlassButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(12.dp),
    content: @Composable RowScope.() -> Unit
) {
    val style = WorldsGlassDefaults.standard()
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
        shape = shape,
        color = style.backgroundColor.copy(alpha = if (enabled) 0.85f else 0.4f),
        border = BorderStroke(1.dp, style.borderColor),
        contentColor = MaterialTheme.colorScheme.onSurface
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            content = content
        )
    }
}

/**
 * Frosted glass modal dialog.
 */
@Composable
fun WorldsGlassDialog(
    onDismissRequest: () -> Unit,
    properties: DialogProperties = DialogProperties(),
    content: @Composable () -> Unit
) {
    Dialog(onDismissRequest = onDismissRequest, properties = properties) {
        WorldsGlassSurface(
            modifier = Modifier
                .fillMaxWidth(0.92f)
                .padding(16.dp),
            shape = RoundedCornerShape(24.dp),
            style = WorldsGlassDefaults.specular()
        ) {
            Box(Modifier.padding(24.dp)) {
                content()
            }
        }
    }
}

/**
 * Frosted glass bottom sheet / side sheet container.
 */
@Composable
fun WorldsGlassSheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    WorldsGlassSurface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)),
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
        style = WorldsGlassDefaults.standard()
    ) {
        Column(Modifier.padding(20.dp), content = content)
    }
}

/**
 * Universal glass container wrapper.
 */
@Composable
fun WorldsGlassContainer(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    WorldsGlassSurface(modifier = modifier) {
        content()
    }
}

/**
 * Translucent glass overlay.
 */
@Composable
fun WorldsGlassOverlay(
    modifier: Modifier = Modifier,
    visible: Boolean = true,
    content: @Composable BoxScope.() -> Unit
) {
    if (visible) {
        Box(
            modifier = modifier
                .background(Color(0x40000000))
                .fillMaxSize(),
            content = content
        )
    }
}

/**
 * Hardware Window Blur Integration for Android 12+ (API 31+) & ChromeOS.
 */
object WorldsWindowBlur {
    /**
     * Enables hardware background blur on supported Android 12+ devices.
     */
    fun enableWindowBlur(activity: Activity, blurRadiusPixels: Int = 40) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val window = activity.window
            val windowManager = activity.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            val isBlurSupported = windowManager?.isCrossWindowBlurEnabled == true
            if (isBlurSupported) {
                window.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
                window.attributes.blurBehindRadius = blurRadiusPixels
                try {
                    window.setBackgroundBlurRadius(blurRadiusPixels)
                } catch (_: Throwable) {}
            }
        }
    }

    /**
     * Disables window blur when leaving glass mode or for low power.
     */
    fun disableWindowBlur(activity: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val window = activity.window
            window.clearFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
            try {
                window.setBackgroundBlurRadius(0)
            } catch (_: Throwable) {}
        }
    }
}
