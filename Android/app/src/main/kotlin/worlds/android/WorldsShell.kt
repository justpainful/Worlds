package worlds.android

import android.text.format.DateUtils
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import worlds.android.glass.GlassKind
import worlds.android.glass.LocalGlassBackdrop
import worlds.android.glass.glassBackdropSource
import worlds.android.glass.rememberGlassBackdrop
import worlds.android.glass.worldsGlass
import worlds.android.glass.worldsGlassLens
import worlds.content.Resource

/** The five destinations shared with iPhone, iPad and Mac. */
internal enum class WorldsDestination(val label: Int, val icon: Int) {
    Home(R.string.tab_home, R.drawable.ic_house),
    Spaces(R.string.tab_spaces, R.drawable.ic_layers),
    Library(R.string.tab_library, R.drawable.ic_folder),
    Ai(R.string.tab_ai, R.drawable.ic_sparkles),
    Search(R.string.tab_search, R.drawable.ic_search),
}

internal data class LibraryFilter(val id: String, val label: Int, val tile: Int, val kinds: Set<String>)
internal val libraryFilters = listOf(
    LibraryFilter("all", R.string.filter_all, R.drawable.pi_library, emptySet()),
    LibraryFilter("docs", R.string.filter_docs, R.drawable.pi_document, setOf("page", "document")),
    LibraryFilter("sheets", R.string.filter_sheets, R.drawable.pi_spreadsheet, setOf("spreadsheet")),
    LibraryFilter("drawings", R.string.filter_drawings, R.drawable.pi_paintbrush, setOf("drawing")),
    LibraryFilter("slides", R.string.filter_slides, R.drawable.pi_presentation, setOf("presentation")),
    LibraryFilter("media", R.string.filter_media, R.drawable.pi_image, setOf("gallery", "file", "stream")),
)

internal class ShellActions(
    val create: (String) -> Unit,
    val open: (String) -> Unit,
    val search: (String) -> Unit,
    val refresh: () -> Unit,
    val settings: () -> Unit,
    val account: (() -> Unit)?,
    val automations: () -> Unit,
    val templates: () -> Unit,
)

private val TAB_BAR_HEIGHT = 62.dp
private val TOOLBAR_HEIGHT = 48.dp

@Composable internal fun WorldsShell(
    state: HomeState,
    actions: ShellActions,
    destination: WorldsDestination,
    onDestination: (WorldsDestination) -> Unit,
    moreOpen: Boolean,
    onMoreOpen: (Boolean) -> Unit,
    moreItems: @Composable ColumnScope.() -> Unit,
    ai: @Composable (Modifier) -> Unit,
    detail: @Composable (Modifier) -> Unit,
) {
    val backdrop = rememberGlassBackdrop()
    val keyboardVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val reduceMotion = LocalAppearancePreferences.current.reduceMotion
    var filterId by rememberSaveable { mutableStateOf("all") }
    var sidebarOpen by rememberSaveable { mutableStateOf(true) }
    CompositionLocalProvider(LocalGlassBackdrop provides backdrop) {
        BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            val compact = maxWidth < 600.dp
            val wide = maxWidth >= 840.dp
            val narrow = maxWidth < 340.dp
            val shellWidth = maxWidth
            val hasSelection = state.selected != null
            Row(Modifier.fillMaxSize()) {
                if (!compact) AnimatedVisibility(visible = sidebarOpen, enter = expandHorizontally(), exit = shrinkHorizontally()) {
                    WorldsSidebar(state, destination, filterId, actions, onSelect = { d, f -> if (hasSelection) actions.open(""); onDestination(d); if (f != null) filterId = f })
                }
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    val detailInsets = Modifier.windowInsetsPadding(WindowInsets.safeDrawing).imePadding()
                    when {
                        hasSelection && !wide -> detail(Modifier.fillMaxSize().then(detailInsets))
                        hasSelection -> Row(Modifier.fillMaxSize()) {
                            ResourceColumn(state, filterId, actions, Modifier.width(340.dp).fillMaxHeight().windowInsetsPadding(WindowInsets.safeDrawing))
                            VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            detail(Modifier.weight(1f).fillMaxHeight().then(detailInsets))
                        }
                        else -> {
                            val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + TOOLBAR_HEIGHT + 22.dp
                            val bottom = if (compact) TAB_BAR_HEIGHT + 34.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() else 28.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
                            val padding = PaddingValues(start = if (compact) 18.dp else 30.dp, end = if (compact) 18.dp else 30.dp, top = top, bottom = bottom)
                            Box(Modifier.fillMaxSize().glassBackdropSource(backdrop).background(MaterialTheme.colorScheme.background)) {
                                Crossfade(targetState = destination, animationSpec = if (reduceMotion) snap() else tween(180), label = "destination") { target ->
                                    when (target) {
                                        WorldsDestination.Home -> HomeDestination(state, actions, padding, shellWidth, onSeeAll = { onDestination(WorldsDestination.Library) })
                                        WorldsDestination.Spaces -> SpacesDestination(state, actions, padding)
                                        WorldsDestination.Library -> LibraryDestination(state, actions, padding, filterId) { filterId = it }
                                        WorldsDestination.Ai -> ai(Modifier.fillMaxSize().padding(bottom = if (compact && !keyboardVisible) TAB_BAR_HEIGHT + 14.dp else 0.dp))
                                        WorldsDestination.Search -> SearchDestination(state, actions, padding)
                                    }
                                }
                            }
                            if (destination != WorldsDestination.Ai) WorldsToolbar(Modifier.align(Alignment.TopEnd).windowInsetsPadding(WindowInsets.statusBars).padding(top = 10.dp, end = if (compact) 14.dp else 22.dp), compact, narrow, actions, moreOpen, onMoreOpen, moreItems)
                            if (!compact && destination != WorldsDestination.Ai) SidebarToggle(Modifier.align(Alignment.TopStart).windowInsetsPadding(WindowInsets.statusBars).padding(top = 10.dp, start = 22.dp), sidebarOpen) { sidebarOpen = !sidebarOpen }
                            if (compact && !keyboardVisible) WorldsTabBar(Modifier.align(Alignment.BottomCenter), destination, narrow, reduceMotion, onDestination)
                        }
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ chrome */

@Composable private fun WorldsTabBar(modifier: Modifier, destination: WorldsDestination, narrow: Boolean, reduceMotion: Boolean, onDestination: (WorldsDestination) -> Unit) {
    val tabs = listOf(WorldsDestination.Home, WorldsDestination.Spaces, WorldsDestination.Library, WorldsDestination.Ai)
    Row(modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).padding(start = 14.dp, end = 14.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        val capsule = RoundedCornerShape(TAB_BAR_HEIGHT / 2)
        BoxWithConstraints(Modifier.weight(1f).height(TAB_BAR_HEIGHT).worldsGlass(capsule)) {
            val itemWidth = maxWidth / tabs.size
            val index = tabs.indexOf(destination)
            val offset by animateDpAsState(targetValue = itemWidth * index.coerceAtLeast(0), animationSpec = if (reduceMotion) snap() else spring(dampingRatio = 0.78f, stiffness = Spring.StiffnessMediumLow), label = "tab lens")
            if (index >= 0) Box(Modifier.offset(x = offset).width(itemWidth).fillMaxHeight().padding(4.dp).worldsGlassLens(RoundedCornerShape(TAB_BAR_HEIGHT / 2 - 4.dp)))
            Row(Modifier.fillMaxSize()) {
                tabs.forEach { tab -> TabItem(tab, tab == destination, narrow, Modifier.width(itemWidth).fillMaxHeight()) { onDestination(tab) } }
            }
        }
        Box(Modifier.size(TAB_BAR_HEIGHT).worldsGlass(CircleShape), contentAlignment = Alignment.Center) {
            if (destination == WorldsDestination.Search) Box(Modifier.fillMaxSize().padding(4.dp).worldsGlassLens(CircleShape))
            val label = stringResource(WorldsDestination.Search.label)
            Box(Modifier.fillMaxSize().clip(CircleShape).clickable(role = Role.Tab) { onDestination(WorldsDestination.Search) }.semantics { contentDescription = label; selected = destination == WorldsDestination.Search }, contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_search), contentDescription = null, modifier = Modifier.size(24.dp), tint = if (destination == WorldsDestination.Search) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

@Composable private fun TabItem(tab: WorldsDestination, active: Boolean, narrow: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val label = stringResource(tab.label)
    val tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
    Column(modifier.clip(RoundedCornerShape(TAB_BAR_HEIGHT / 2)).clickable(role = Role.Tab, onClick = onClick).semantics { contentDescription = label; selected = active }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(painterResource(tab.icon), contentDescription = null, modifier = Modifier.size(23.dp), tint = tint)
        if (!narrow) Text(label, modifier = Modifier.padding(top = 1.dp).clearAndSetSemantics { }, color = tint, fontSize = 10.5.sp, lineHeight = 14.sp, maxLines = 1, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable private fun ToolbarIcon(icon: Int, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(22.dp), tint = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun WorldsToolbar(modifier: Modifier, compact: Boolean, narrow: Boolean, actions: ShellActions, moreOpen: Boolean, onMoreOpen: (Boolean) -> Unit, moreItems: @Composable ColumnScope.() -> Unit) {
    Row(modifier.height(TOOLBAR_HEIGHT).worldsGlass(RoundedCornerShape(TOOLBAR_HEIGHT / 2)).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (!narrow) FocusTimer()
        ToolbarIcon(R.drawable.ic_plus, stringResource(R.string.create_new)) { actions.create("page") }
        if (!compact && actions.account != null) ToolbarIcon(R.drawable.ic_circle_user, stringResource(R.string.account_title), onClick = actions.account)
        ToolbarIcon(R.drawable.ic_settings_2, stringResource(R.string.appearance_title), onClick = actions.settings)
        Box {
            ToolbarIcon(R.drawable.ic_ellipsis_vertical, stringResource(R.string.library_more_actions)) { onMoreOpen(true) }
            DropdownMenu(expanded = moreOpen, onDismissRequest = { onMoreOpen(false) }, content = moreItems)
        }
    }
}

@Composable private fun SidebarToggle(modifier: Modifier, open: Boolean, onClick: () -> Unit) {
    Box(modifier.size(TOOLBAR_HEIGHT).worldsGlass(CircleShape), contentAlignment = Alignment.Center) {
        ToolbarIcon(R.drawable.ic_panel_left, stringResource(if (open) R.string.sidebar_hide else R.string.sidebar_show), onClick = onClick)
    }
}

/** The focus capsule from the Apple toolbars. Tap to run or pause, hold to reset. */
@OptIn(ExperimentalFoundationApi::class)
@Composable private fun FocusTimer() {
    val total = 25 * 60
    var remaining by rememberSaveable { mutableIntStateOf(total) }
    var running by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(running) {
        while (running && remaining > 0) { delay(1000); remaining -= 1 }
        if (remaining == 0) running = false
    }
    val label = stringResource(if (running) R.string.focus_pause else R.string.focus_start)
    Row(Modifier.height(44.dp).clip(CircleShape).combinedClickable(role = Role.Button, onLongClick = { running = false; remaining = total }, onClick = { if (remaining == 0) remaining = total; running = !running }).semantics { contentDescription = label }.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(painterResource(R.drawable.ic_timer), contentDescription = null, modifier = Modifier.size(20.dp), tint = if (running) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        Text("%02d:%02d".format(java.util.Locale.ROOT, remaining / 60, remaining % 60), modifier = Modifier.clearAndSetSemantics { }, style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurface)
    }
}

@Composable private fun WorldsSidebar(state: HomeState, destination: WorldsDestination, filterId: String, actions: ShellActions, onSelect: (WorldsDestination, String?) -> Unit) {
    Column(Modifier.width(258.dp).fillMaxHeight().background(MaterialTheme.colorScheme.surfaceContainerLow).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Vertical + WindowInsetsSides.Start)).padding(horizontal = 12.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, top = 14.dp, bottom = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            androidx.compose.foundation.Image(painterResource(R.drawable.worlds_icon), contentDescription = null, modifier = Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)))
            Text("Worlds", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            SidebarHeading(stringResource(R.string.section_workspace))
            WorldsDestination.entries.forEach { item -> SidebarRow(item.icon, null, stringResource(item.label), destination == item) { onSelect(item, null) } }
            Spacer(Modifier.height(14.dp))
            SidebarHeading(stringResource(R.string.section_collections))
            libraryFilters.drop(1).forEach { filter -> SidebarRow(null, filter.tile, stringResource(filter.label), destination == WorldsDestination.Library && filterId == filter.id) { onSelect(WorldsDestination.Library, filter.id) } }
            SidebarRow(null, R.drawable.pi_templates, stringResource(R.string.templates_title), false, actions.templates)
            SidebarRow(null, R.drawable.pi_automations, stringResource(R.string.automations), false, actions.automations)
            val recents = state.pages.filter { it.deletedAt == null }.take(5)
            if (recents.isNotEmpty() && state.query.isBlank()) {
                Spacer(Modifier.height(14.dp))
                SidebarHeading(stringResource(R.string.section_recent))
                recents.forEach { page -> SidebarRow(null, worldsTile(page.kind), page.title.ifBlank { stringResource(R.string.untitled) }, page.id == state.selected?.resource?.id) { actions.open(page.id) } }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        SidebarRow(R.drawable.ic_settings_2, null, stringResource(R.string.appearance_title), false, actions.settings)
    }
}

@Composable private fun SidebarHeading(text: String) {
    Text(text, modifier = Modifier.padding(start = 10.dp, top = 4.dp, bottom = 4.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun SidebarRow(icon: Int?, tile: Int?, label: String, active: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(Modifier.fillMaxWidth().heightIn(min = 42.dp).clip(shape).background(if (active) MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
        if (icon != null) Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(20.dp), tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
        if (tile != null) WorldsTile(tile, 22.dp)
        Text(label, modifier = Modifier.clearAndSetSemantics { contentDescription = label }, style = MaterialTheme.typography.bodyMedium, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/* ------------------------------------------------------------ destinations */

@Composable private fun LargeTitle(text: String, subtitle: String? = null) {
    Column(Modifier.padding(bottom = 18.dp)) {
        Text(text, style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.onBackground)
        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun kindLabel(kind: String): String = stringResource(when (kind) {
    "document" -> R.string.kind_document
    "spreadsheet" -> R.string.kind_spreadsheet
    "presentation" -> R.string.kind_presentation
    "drawing" -> R.string.kind_drawing
    "project" -> R.string.kind_project
    "gallery" -> R.string.kind_gallery
    "file" -> R.string.kind_file
    "stream" -> R.string.kind_stream
    else -> R.string.kind_page
})

@Composable private fun relativeTime(time: Long): String {
    val now = System.currentTimeMillis()
    return if (now - time < DateUtils.MINUTE_IN_MILLIS) stringResource(R.string.just_now) else DateUtils.getRelativeTimeSpanString(time, now, DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE).toString()
}

@Composable private fun LoadingOrError(state: HomeState, actions: ShellActions) {
    when {
        state.loading -> CircularProgressIndicator(Modifier.padding(16.dp))
        state.error -> Column {
            Text(stringResource(R.string.error_loading), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = actions.refresh) { Text(stringResource(R.string.retry)) }
        }
    }
}

@Composable private fun EmptyState(tile: Int, title: String, body: String?, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        WorldsTile(tile, 60.dp)
        Text(title, modifier = Modifier.padding(top = 6.dp), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
        if (body != null) Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) Box(Modifier.padding(top = 8.dp)) { action() }
    }
}

@Composable private fun ContinueCard(page: Resource, modifier: Modifier, onClick: () -> Unit) {
    WorldsCard(modifier, onClick = onClick) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
            WorldsTile(worldsTile(page.kind), 46.dp)
            Column(Modifier.weight(1f)) {
                Text(page.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${kindLabel(page.kind)} · ${relativeTime(page.updatedAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(painterResource(R.drawable.ic_arrow_up_right), contentDescription = null, modifier = Modifier.size(18.dp).scale(if (LocalLayoutDirection.current == androidx.compose.ui.unit.LayoutDirection.Rtl) -1f else 1f, 1f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun ResourceRow(page: Resource, active: Boolean, showDivider: Boolean, onClick: () -> Unit) {
    Column {
        Row(Modifier.fillMaxWidth().background(if (active) MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
            WorldsTile(worldsTile(page.kind), 38.dp)
            Column(Modifier.weight(1f)) {
                Text(page.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${kindLabel(page.kind)} · ${relativeTime(page.updatedAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (showDivider) HorizontalDivider(Modifier.padding(start = 65.dp), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable internal fun PageRow(page: Resource, selected: Boolean, onClick: () -> Unit) = ResourceRow(page, selected, true, onClick)

/** Rows in one rounded group with inset hairlines. */
@Composable private fun ResourceGroup(pages: List<Resource>, selectedId: String?, onOpen: (String) -> Unit) {
    WorldsCard(Modifier.fillMaxWidth()) {
        pages.forEachIndexed { index, page -> key(page.id) { ResourceRow(page, page.id == selectedId, index < pages.lastIndex) { onOpen(page.id) } } }
    }
}

@Composable private fun CreateChip(tile: Int, label: String, describeOnly: Boolean = true, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Row(Modifier.clip(shape).background(MaterialTheme.colorScheme.surface).clickable(role = Role.Button, onClick = onClick).then(if (describeOnly) Modifier.semantics { contentDescription = label } else Modifier).heightIn(min = 46.dp).padding(start = 9.dp, end = 15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        WorldsTile(tile, 28.dp)
        Text(label, modifier = if (describeOnly) Modifier.clearAndSetSemantics { } else Modifier, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface, maxLines = 1)
    }
}

@Composable private fun HomeDestination(state: HomeState, actions: ShellActions, padding: PaddingValues, width: Dp, onSeeAll: () -> Unit) {
    val pages = state.pages
    val columns = if (width >= 900.dp) 2 else 1
    LazyColumn(Modifier.fillMaxSize(), contentPadding = padding) {
        item { LargeTitle(stringResource(if (state.trash) R.string.trash else R.string.tab_home), stringResource(R.string.local_label)) }
        if (state.loading || state.error) item { LoadingOrError(state, actions) }
        else {
            if (pages.isNotEmpty() && !state.trash) {
                item { WorldsSectionTitle(stringResource(R.string.continue_working), Modifier.padding(bottom = 10.dp)) }
                items(pages.take(2).chunked(columns)) { row ->
                    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        row.forEach { page -> ContinueCard(page, Modifier.weight(1f)) { actions.open(page.id) } }
                    }
                }
            }
            if (!state.trash) item { CreateRow(actions, pages.isEmpty(), padding.calculateLeftPadding(androidx.compose.ui.unit.LayoutDirection.Ltr)) }
            if (pages.isEmpty()) item {
                EmptyState(if (state.trash) R.drawable.pi_trash else R.drawable.pi_pages, stringResource(if (state.trash) R.string.trash_empty else R.string.empty_title), if (state.trash) null else stringResource(R.string.empty_body))
            }
            val rest = if (state.trash) pages else pages.drop(2)
            if (rest.isNotEmpty()) {
                item {
                    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        WorldsSectionTitle(stringResource(R.string.recent_resources))
                        TextButton(onClick = onSeeAll) { Text(stringResource(R.string.see_all)) }
                    }
                }
                item { ResourceGroup(rest.take(30), state.selected?.resource?.id, actions.open) }
            }
        }
    }
}

@Composable private fun CreateRow(actions: ShellActions, first: Boolean, edge: Dp) {
    Column(Modifier.padding(top = if (first) 0.dp else 12.dp, bottom = 20.dp)) {
        WorldsSectionTitle(stringResource(R.string.start_something_new), Modifier.padding(bottom = 10.dp))
        Row(Modifier.bleedHorizontally(edge).horizontalScroll(rememberScrollState()).padding(horizontal = edge), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CreateChip(R.drawable.pi_pages, stringResource(R.string.new_page), describeOnly = false) { actions.create("page") }
            CreateChip(R.drawable.pi_document, stringResource(R.string.new_document)) { actions.create("document") }
            CreateChip(R.drawable.pi_spreadsheet, stringResource(R.string.new_spreadsheet)) { actions.create("spreadsheet") }
            CreateChip(R.drawable.pi_paintbrush, stringResource(R.string.new_drawing)) { actions.create("drawing") }
            CreateChip(R.drawable.pi_presentation, stringResource(R.string.presentation_new)) { actions.create("presentation") }
        }
    }
}

@Composable private fun SpacesDestination(state: HomeState, actions: ShellActions, padding: PaddingValues) {
    val spaces = state.pages.filter { it.kind == "project" || it.kind == "gallery" }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = padding) {
        item { LargeTitle(stringResource(R.string.tab_spaces)) }
        if (state.loading || state.error) item { LoadingOrError(state, actions) }
        else {
            if (spaces.isEmpty()) item {
                EmptyState(R.drawable.pi_briefcase, stringResource(R.string.spaces_empty_title), stringResource(R.string.spaces_empty_body)) {
                    Button(onClick = { actions.create("project") }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.project_new)) }
                }
            } else item { ResourceGroup(spaces, state.selected?.resource?.id, actions.open); Spacer(Modifier.height(22.dp)) }
            item {
                WorldsSectionTitle(stringResource(R.string.workspace_tools), Modifier.padding(bottom = 10.dp))
                WorldsCard(Modifier.fillMaxWidth()) {
                    if (actions.account != null) { ToolRow(R.drawable.pi_profile, stringResource(R.string.shared_workspaces), actions.account); HorizontalDivider(Modifier.padding(start = 65.dp), color = MaterialTheme.colorScheme.outlineVariant) }
                    ToolRow(R.drawable.pi_templates, stringResource(R.string.templates_title), actions.templates)
                    HorizontalDivider(Modifier.padding(start = 65.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    ToolRow(R.drawable.pi_automations, stringResource(R.string.automations), actions.automations)
                }
            }
        }
    }
}

@Composable private fun ToolRow(tile: Int, label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
        WorldsTile(tile, 38.dp)
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
        Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun LibraryDestination(state: HomeState, actions: ShellActions, padding: PaddingValues, filterId: String, onFilter: (String) -> Unit) {
    val filter = libraryFilters.firstOrNull { it.id == filterId } ?: libraryFilters.first()
    val pages = if (filter.kinds.isEmpty()) state.pages else state.pages.filter { it.kind in filter.kinds }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = padding) {
        item { LargeTitle(stringResource(if (state.trash) R.string.trash else R.string.tab_library)) }
        item {
            val edge = padding.calculateLeftPadding(androidx.compose.ui.unit.LayoutDirection.Ltr)
            Row(Modifier.bleedHorizontally(edge).horizontalScroll(rememberScrollState()).padding(start = edge, end = edge, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                libraryFilters.forEach { item ->
                    val active = item.id == filter.id
                    val shape = CircleShape
                    Text(stringResource(item.label), modifier = Modifier.clip(shape).background(if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface).clickable { onFilter(item.id) }.padding(horizontal = 14.dp, vertical = 9.dp), style = MaterialTheme.typography.labelLarge, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                }
            }
        }
        when {
            state.loading || state.error -> item { LoadingOrError(state, actions) }
            pages.isEmpty() -> item { EmptyState(if (state.trash) R.drawable.pi_trash else filter.tile, stringResource(if (state.trash) R.string.trash_empty else R.string.empty_title), if (state.trash) null else stringResource(R.string.empty_body)) }
            else -> item { ResourceGroup(pages, state.selected?.resource?.id, actions.open) }
        }
    }
}

@Composable private fun SearchDestination(state: HomeState, actions: ShellActions, padding: PaddingValues) {
    val keyboard = LocalSoftwareKeyboardController.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = padding) {
        item { LargeTitle(stringResource(R.string.tab_search)) }
        item {
            OutlinedTextField(value = state.query, onValueChange = actions.search, label = { Text(stringResource(R.string.search)) }, singleLine = true,
                leadingIcon = { WorldsGlyph(R.drawable.ic_search) }, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = MaterialTheme.colorScheme.surface, unfocusedContainerColor = MaterialTheme.colorScheme.surface))
        }
        when {
            state.loading || state.error -> item { LoadingOrError(state, actions) }
            state.pages.isEmpty() -> item { EmptyState(R.drawable.pi_search, stringResource(R.string.no_results), null) }
            else -> item { ResourceGroup(state.pages, state.selected?.resource?.id, actions.open) }
        }
    }
}

/** The list beside an open item on wide screens. */
@Composable private fun ResourceColumn(state: HomeState, filterId: String, actions: ShellActions, modifier: Modifier) {
    val filter = libraryFilters.firstOrNull { it.id == filterId } ?: libraryFilters.first()
    val pages = if (filter.kinds.isEmpty()) state.pages else state.pages.filter { it.kind in filter.kinds }
    LazyColumn(modifier, contentPadding = PaddingValues(14.dp)) {
        item { Text(stringResource(filter.label), modifier = Modifier.padding(start = 4.dp, bottom = 10.dp), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground) }
        items(pages, key = { it.id }) { page ->
            val shape = RoundedCornerShape(12.dp)
            val active = page.id == state.selected?.resource?.id
            Row(Modifier.fillMaxWidth().clip(shape).background(if (active) MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent).clickable { actions.open(page.id) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                WorldsTile(worldsTile(page.kind), 34.dp)
                Column(Modifier.weight(1f)) {
                    Text(page.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.titleSmall, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(relativeTime(page.updatedAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
    }
}
