package worlds.android

import android.os.Build
import android.view.WindowManager
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.layout
import worlds.android.glass.worldsGlass
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider

/** Values shared with the Windows `tokens.css` and Apple `WorldsPalette`. */
internal object WorldsTokens {
    val canvasDark = Color(0xFF0C0C0E)
    val canvasLight = Color(0xFFF6F6F4)
    val sidebarDark = Color(0xFF121215)
    val sidebarLight = Color(0xFFEFEFEC)
    val cardDark = Color(0xFF18181C)
    val cardLight = Color.White
    val raisedDark = Color(0xFF242428)
    val raisedLight = Color(0xFFEDEDEA)
    val inkDark = Color(0xFFF5F5F7)
    val inkLight = Color(0xFF1C1C1F)
    val secondaryDark = Color(0xFFA7A7AE)
    val secondaryLight = Color(0xFF5E5E64)
    val hairlineDark = Color(0x14FFFFFF)
    val hairlineLight = Color(0x12000000)
}

internal val WorldsSans = FontFamily(
    Font(R.font.worlds_sans_regular, FontWeight.Normal),
    Font(R.font.worlds_sans_medium, FontWeight.Medium),
    Font(R.font.worlds_sans_semibold, FontWeight.SemiBold),
    Font(R.font.worlds_sans_bold, FontWeight.Bold),
)

private fun style(size: Float, line: Float, weight: FontWeight) =
    TextStyle(fontFamily = WorldsSans, fontSize = size.sp, lineHeight = line.sp, fontWeight = weight, letterSpacing = 0.sp)

/** The desktop type scale. Letter spacing stays 0 so joined Arabic letters do not break. */
internal val WorldsTypography = Typography(
    displayLarge = style(40f, 48f, FontWeight.SemiBold),
    displayMedium = style(36f, 44f, FontWeight.SemiBold),
    displaySmall = style(34f, 42f, FontWeight.SemiBold),
    headlineLarge = style(30f, 38f, FontWeight.SemiBold),
    headlineMedium = style(25f, 33f, FontWeight.SemiBold),
    headlineSmall = style(22f, 30f, FontWeight.SemiBold),
    titleLarge = style(19.5f, 27f, FontWeight.SemiBold),
    titleMedium = style(16f, 24f, FontWeight.SemiBold),
    titleSmall = style(14f, 21f, FontWeight.SemiBold),
    bodyLarge = style(15.5f, 26f, FontWeight.Normal),
    bodyMedium = style(14f, 23f, FontWeight.Normal),
    bodySmall = style(12.5f, 20f, FontWeight.Normal),
    labelLarge = style(14f, 20f, FontWeight.SemiBold),
    labelMedium = style(12.5f, 18f, FontWeight.Medium),
    labelSmall = style(11.5f, 16f, FontWeight.Medium),
)

internal val WorldsShapes = Shapes(
    extraSmall = RoundedCornerShape(9.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
    extraLarge = RoundedCornerShape(26.dp),
)

internal fun worldsColorScheme(dark: Boolean, primary: Color): ColorScheme {
    val on = if (dark) Color(0xFF171719) else Color.White
    val container = lerp(primary, if (dark) WorldsTokens.cardDark else Color.White, 0.84f)
    return if (dark) darkColorScheme(
        primary = primary, onPrimary = on, primaryContainer = container, onPrimaryContainer = primary,
        secondary = primary, onSecondary = on, secondaryContainer = container, onSecondaryContainer = primary,
        background = WorldsTokens.canvasDark, onBackground = WorldsTokens.inkDark,
        surface = WorldsTokens.cardDark, onSurface = WorldsTokens.inkDark,
        surfaceVariant = WorldsTokens.raisedDark, onSurfaceVariant = WorldsTokens.secondaryDark,
        surfaceContainerLowest = WorldsTokens.canvasDark, surfaceContainerLow = WorldsTokens.sidebarDark,
        surfaceContainer = WorldsTokens.cardDark, surfaceContainerHigh = WorldsTokens.raisedDark, surfaceContainerHighest = Color(0xFF2E2E33),
        outline = Color(0x38FFFFFF), outlineVariant = WorldsTokens.hairlineDark,
        error = Color(0xFFE5675F), onError = Color(0xFF1C0B09),
    ) else lightColorScheme(
        primary = primary, onPrimary = on, primaryContainer = container, onPrimaryContainer = primary,
        secondary = primary, onSecondary = on, secondaryContainer = container, onSecondaryContainer = primary,
        background = WorldsTokens.canvasLight, onBackground = WorldsTokens.inkLight,
        surface = WorldsTokens.cardLight, onSurface = WorldsTokens.inkLight,
        surfaceVariant = WorldsTokens.raisedLight, onSurfaceVariant = WorldsTokens.secondaryLight,
        surfaceContainerLowest = Color.White, surfaceContainerLow = WorldsTokens.sidebarLight,
        surfaceContainer = Color.White, surfaceContainerHigh = WorldsTokens.raisedLight, surfaceContainerHighest = Color(0xFFE4E4E1),
        outline = Color(0x33000000), outlineVariant = WorldsTokens.hairlineLight,
        error = Color(0xFFB3362C), onError = Color.White,
    )
}

/** The desktop's 3D tile for each resource kind. */
internal fun worldsTile(kind: String): Int = when (kind) {
    "document" -> R.drawable.pi_document
    "spreadsheet" -> R.drawable.pi_spreadsheet
    "presentation" -> R.drawable.pi_presentation
    "drawing" -> R.drawable.pi_paintbrush
    "project" -> R.drawable.pi_briefcase
    "gallery" -> R.drawable.pi_image
    "file" -> R.drawable.pi_file
    "stream" -> R.drawable.pi_film
    "template" -> R.drawable.pi_templates
    else -> R.drawable.pi_pages
}

@Composable internal fun WorldsTile(tile: Int, size: Dp = 40.dp, modifier: Modifier = Modifier) {
    Image(painterResource(tile), contentDescription = null, modifier = modifier.size(size))
}

/** A calm content surface: opaque, one hairline, no glass. */
@Composable internal fun WorldsCard(modifier: Modifier = Modifier, radius: Dp = 16.dp, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(radius)
    Column(modifier.clip(shape).background(MaterialTheme.colorScheme.surface).border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, shape).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier), content = content)
}

@Composable internal fun WorldsSectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
}

/** Back control used by every pushed screen. */
@Composable internal fun WorldsBackButton(onClick: () -> Unit, enabled: Boolean = true) {
    val mirrored = LocalLayoutDirection.current == LayoutDirection.Rtl
    Surface(onClick = onClick, enabled = enabled, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh, contentColor = MaterialTheme.colorScheme.onSurface, modifier = Modifier.heightIn(min = 40.dp)) {
        Row(Modifier.padding(start = 10.dp, end = 16.dp).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = null, modifier = Modifier.size(20.dp).scale(if (mirrored) -1f else 1f, 1f))
            Text(stringResource(R.string.back), style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** Secondary action in a screen's action row: a neutral capsule, so only the primary action carries the accent. */
@Composable internal fun WorldsActionButton(onClick: () -> Unit, enabled: Boolean = true, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    androidx.compose.material3.FilledTonalButton(onClick = onClick, enabled = enabled, colors = androidx.compose.material3.ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh, contentColor = MaterialTheme.colorScheme.onSurface), content = content)
}

/** Back control for screens whose chrome floats on glass. */
@Composable internal fun WorldsGlassBackButton(onClick: () -> Unit, enabled: Boolean = true) {
    val mirrored = LocalLayoutDirection.current == LayoutDirection.Rtl
    val shape = RoundedCornerShape(25.dp)
    Row(Modifier.heightIn(min = 50.dp).worldsGlass(shape).clip(shape).clickable(enabled = enabled, onClick = onClick).padding(start = 12.dp, end = 18.dp).heightIn(min = 50.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = null, modifier = Modifier.size(20.dp).scale(if (mirrored) -1f else 1f, 1f), tint = MaterialTheme.colorScheme.onSurface)
        Text(stringResource(R.string.back), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface)
    }
}

/** Lets a scrolling row run to the screen edge inside padded content. */
internal fun Modifier.bleedHorizontally(inset: Dp): Modifier = layout { measurable, constraints ->
    val extra = (inset * 2).roundToPx()
    val placeable = measurable.measure(constraints.copy(minWidth = constraints.maxWidth + extra, maxWidth = constraints.maxWidth + extra))
    layout(constraints.maxWidth, placeable.height) { placeable.placeRelative(-inset.roundToPx(), 0) }
}

/** Dialogs everywhere in the app: one raised sheet, blur behind on Android 12 and later. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun AlertDialog(
    onDismissRequest: () -> Unit,
    confirmButton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    dismissButton: (@Composable () -> Unit)? = null,
    title: (@Composable () -> Unit)? = null,
    text: (@Composable () -> Unit)? = null,
    properties: DialogProperties = DialogProperties(),
) {
    Dialog(onDismissRequest = onDismissRequest, properties = properties) {
        val view = LocalView.current
        DisposableEffect(view) {
            if (Build.VERSION.SDK_INT >= 31) (view.parent as? DialogWindowProvider)?.window?.let { window ->
                window.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
                window.attributes = window.attributes.apply { blurBehindRadius = 48; dimAmount = 0.42f }
            }
            onDispose { }
        }
        val shape = RoundedCornerShape(26.dp)
        Column(modifier.widthIn(min = 280.dp, max = 460.dp).fillMaxWidth().clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHigh).border(BorderStroke(0.5.dp, MaterialTheme.colorScheme.outline), shape).padding(22.dp)) {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
                if (title != null) {
                    CompositionLocalProvider(LocalTextStyle provides MaterialTheme.typography.titleLarge) { title() }
                    androidx.compose.foundation.layout.Spacer(Modifier.size(10.dp))
                }
                if (text != null) Box(Modifier.weight(1f, fill = false)) {
                    CompositionLocalProvider(LocalTextStyle provides MaterialTheme.typography.bodyMedium) { text() }
                }
                androidx.compose.foundation.layout.Spacer(Modifier.size(14.dp))
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End)) {
                    dismissButton?.invoke()
                    confirmButton()
                }
            }
        }
    }
}

/** Menus everywhere in the app share the popover radius and raised surface. */
@Composable internal fun DropdownMenu(expanded: Boolean, onDismissRequest: () -> Unit, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    androidx.compose.material3.DropdownMenu(
        expanded = expanded, onDismissRequest = onDismissRequest, modifier = modifier,
        shape = RoundedCornerShape(20.dp), containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 0.dp, shadowElevation = 18.dp, border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outline), content = content,
    )
}
