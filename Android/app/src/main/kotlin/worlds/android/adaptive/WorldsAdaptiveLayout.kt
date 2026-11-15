package worlds.android.adaptive

import android.content.Context
import android.content.res.Configuration
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import worlds.android.R
import worlds.android.WorldsGlyph

/**
 * WorldsAdaptiveLayout Engine:
 * Central adaptive layout system for Android Phones, Foldables, Tablets, and Chromebooks.
 * Supports WindowSizeClass breakpoints, foldable posture detection, multi-pane scaffolds,
 * ChromeOS freeform windows, desktop keyboard shortcuts, and trackpad/mouse navigation.
 */

enum class WindowWidthSizeClass {
    Compact,    // < 600dp (standard phones in portrait)
    Medium,     // 600..839dp (tablets in portrait, foldables unfolded, small laptops)
    Expanded,   // 840..1199dp (tablets in landscape, desktop windows)
    Large,      // 1200..1599dp (large monitors, Chromebook full-screen)
    ExtraLarge  // >= 1600dp (ultra-wide desktop displays)
}

enum class WindowHeightSizeClass {
    Compact,    // < 480dp (phones in landscape)
    Medium,     // 480..899dp (phones in portrait, foldables)
    Expanded    // >= 900dp (tablets, large screens)
}

enum class FoldablePosture {
    Flat,
    HalfOpenedTabletop,
    HalfOpenedBook,
    Flipped
}

data class WindowAdaptiveInfo(
    val widthClass: WindowWidthSizeClass,
    val heightClass: WindowHeightSizeClass,
    val widthDp: Dp,
    val heightDp: Dp,
    val posture: FoldablePosture,
    val isTablet: Boolean,
    val isFoldable: Boolean,
    val isChromeOS: Boolean
) {
    val isMultiPaneSupported: Boolean
        get() = widthClass in setOf(WindowWidthSizeClass.Expanded, WindowWidthSizeClass.Large, WindowWidthSizeClass.ExtraLarge)

    val isThreePaneSupported: Boolean
        get() = widthClass in setOf(WindowWidthSizeClass.Large, WindowWidthSizeClass.ExtraLarge)
}

/**
 * Calculates current window adaptive information dynamically.
 */
@Composable
fun rememberWindowAdaptiveInfo(): WindowAdaptiveInfo {
    val configuration = LocalConfiguration.current
    val context = LocalContext.current
    val widthDp = configuration.screenWidthDp.dp
    val heightDp = configuration.screenHeightDp.dp

    val widthClass = when {
        widthDp < 600.dp -> WindowWidthSizeClass.Compact
        widthDp < 840.dp -> WindowWidthSizeClass.Medium
        widthDp < 1200.dp -> WindowWidthSizeClass.Expanded
        widthDp < 1600.dp -> WindowWidthSizeClass.Large
        else -> WindowWidthSizeClass.ExtraLarge
    }

    val heightClass = when {
        heightDp < 480.dp -> WindowHeightSizeClass.Compact
        heightDp < 900.dp -> WindowHeightSizeClass.Medium
        else -> WindowHeightSizeClass.Expanded
    }

    // ChromeOS check (ARC environment or system feature)
    val isChromeOS = remember(context) {
        context.packageManager.hasSystemFeature("org.chromium.arc") ||
                context.packageManager.hasSystemFeature("org.chromium.arc.device_management")
    }

    val isTablet = (widthDp >= 600.dp && heightDp >= 600.dp) || configuration.smallestScreenWidthDp >= 600
    val isFoldable = configuration.smallestScreenWidthDp in 540..720 && widthDp != heightDp

    val posture = FoldablePosture.Flat

    return remember(widthClass, heightClass, widthDp, heightDp, posture, isTablet, isFoldable, isChromeOS) {
        WindowAdaptiveInfo(
            widthClass = widthClass,
            heightClass = heightClass,
            widthDp = widthDp,
            heightDp = heightDp,
            posture = posture,
            isTablet = isTablet,
            isFoldable = isFoldable,
            isChromeOS = isChromeOS
        )
    }
}

/**
 * Adaptive navigation suite that switches between:
 * - Bottom navigation bar on Compact screens
 * - Navigation rail on Medium screens
 * - Persistent navigation drawer/sidebar on Expanded, Large, and ExtraLarge screens
 */
@Composable
fun AdaptiveNavigationSuite(
    adaptiveInfo: WindowAdaptiveInfo,
    navigationItems: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    when (adaptiveInfo.widthClass) {
        WindowWidthSizeClass.Compact -> {
            Column(modifier.fillMaxSize()) {
                Box(Modifier.weight(1f)) {
                    content()
                }
                Surface(
                    tonalElevation = 3.dp,
                    color = MaterialTheme.colorScheme.surface
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().height(64.dp),
                        horizontalArrangement = Arrangement.SpaceAround,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        navigationItems()
                    }
                }
            }
        }
        WindowWidthSizeClass.Medium -> {
            Row(modifier.fillMaxSize()) {
                Surface(
                    tonalElevation = 2.dp,
                    color = MaterialTheme.colorScheme.surface,
                    modifier = Modifier.width(80.dp).fillMaxHeight()
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(vertical = 16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        navigationItems()
                    }
                }
                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Box(Modifier.weight(1f)) {
                    content()
                }
            }
        }
        else -> {
            // Expanded, Large, ExtraLarge: Persistent multi-column layout
            Row(modifier.fillMaxSize()) {
                Surface(
                    tonalElevation = 1.dp,
                    color = MaterialTheme.colorScheme.surface,
                    modifier = Modifier.width(280.dp).fillMaxHeight()
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        navigationItems()
                    }
                }
                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Box(Modifier.weight(1f)) {
                    content()
                }
            }
        }
    }
}

/**
 * Adaptive multi-pane layout: List + Detail + optional Inspector/Supporting pane.
 */
@Composable
fun AdaptiveListDetailPane(
    adaptiveInfo: WindowAdaptiveInfo,
    listPane: @Composable BoxScope.() -> Unit,
    detailPane: (@Composable BoxScope.() -> Unit)?,
    supportingPane: (@Composable BoxScope.() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Row(modifier.fillMaxSize()) {
        if (!adaptiveInfo.isMultiPaneSupported) {
            // Single pane mode: Show detail if selected, otherwise list
            Box(Modifier.fillMaxSize()) {
                if (detailPane != null) {
                    detailPane()
                } else {
                    listPane()
                }
            }
        } else {
            // Two-pane or three-pane mode
            Box(
                Modifier
                    .width(if (adaptiveInfo.widthClass == WindowWidthSizeClass.Medium) 360.dp else 420.dp)
                    .fillMaxHeight()
            ) {
                listPane()
            }
            VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Box(Modifier.weight(1f).fillMaxHeight()) {
                if (detailPane != null) {
                    detailPane()
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            text = stringResource(R.string.adaptive_select_item),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            if (adaptiveInfo.isThreePaneSupported && supportingPane != null) {
                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Box(Modifier.width(340.dp).fillMaxHeight()) {
                    supportingPane()
                }
            }
        }
    }
}

/**
 * Desktop & ChromeOS Global Keyboard Shortcut Handler.
 */
@Composable
fun DesktopKeyboardShortcutHandler(
    modifier: Modifier = Modifier,
    onSave: (() -> Unit)? = null,
    onFind: (() -> Unit)? = null,
    onNewPage: (() -> Unit)? = null,
    onClose: (() -> Unit)? = null,
    onUndo: (() -> Unit)? = null,
    onRedo: (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    Box(
        modifier = modifier
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown) {
                    val ctrl = event.isCtrlPressed || event.isMetaPressed
                    when {
                        ctrl && event.key == Key.S && onSave != null -> { onSave(); true }
                        ctrl && event.key == Key.F && onFind != null -> { onFind(); true }
                        ctrl && event.key == Key.N && onNewPage != null -> { onNewPage(); true }
                        ctrl && event.key == Key.W && onClose != null -> { onClose(); true }
                        ctrl && event.key == Key.Z && !event.isShiftPressed && onUndo != null -> { onUndo(); true }
                        ctrl && (event.key == Key.Y || (event.key == Key.Z && event.isShiftPressed)) && onRedo != null -> { onRedo(); true }
                        else -> false
                    }
                } else false
            }
    ) {
        content()
    }
}

/**
 * Hierarchical breadcrumbs component for desktop navigation.
 */
@Composable
fun WorldsBreadcrumbs(
    paths: List<Pair<String, () -> Unit>>,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        paths.forEachIndexed { index, (label, onClick) ->
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (index == paths.lastIndex) FontWeight.Bold else FontWeight.Normal,
                color = if (index == paths.lastIndex) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable(onClick = onClick)
            )
            if (index < paths.lastIndex) {
                WorldsGlyph(
                    R.drawable.ic_chevron_right,
                    tint = MaterialTheme.colorScheme.outlineVariant,
                    modifier = Modifier.size(14.dp)
                )
            }
        }
    }
}
